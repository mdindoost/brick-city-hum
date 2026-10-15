/**
 * The audio engine: the master chain, spatialisation and the voice budget.
 *
 * These live here, not in the voices, because they are mix-wide invariants that no
 * single voice may be trusted with (SPEC §6.8). A voice asks for a destination and
 * gets one that is already behind the limiter.
 *
 * Phase 0 builds only what the lab needs to prove the measurement chain. Ground and
 * Color layers, dayparts and sections are Phase 1 and 2.
 */

import * as Tone from 'tone';
import type { AudioConfig } from '../../../shared/protocol.js';
import {
  bearingToPan,
  distanceToMix,
  type PublicEvent,
  type Voice,
  type VoiceContext,
  type VoiceOutput,
} from './types.js';
import { randomForEvent } from '../../../shared/random.js';

export interface EngineOptions {
  /** §6.8: 24 desktop / 12 mobile. Configurable because it is a device budget. */
  readonly maxVoices: number;
  /** Integrated loudness target in LUFS (§6.8). Measured in the lab, not here. */
  readonly targetLufs: number;
  /** Seed for the current section, from the server (§5). */
  readonly sectionSeed: number;
  readonly scale: readonly number[];
  readonly rootMidi: number;
  readonly bpm: number;
  /** The master chain, from score.yaml (§6.8). */
  readonly master: AudioConfig['master'];
  /** Level for events the governor demoted to texture (§6.5). */
  readonly textureGain: number;
  /**
   * How the Ground follows the city (§6.1, §6.5).
   *
   * Round 6's listening produced the clearest correlation this project has: every
   * moment Mohammad called alive sat in a dense stretch (51–108 events a minute) and
   * every moment the bed bothered him sat in a thin one (12–30). A bed at a fixed
   * level is too loud whenever the city goes quiet and right when it is busy, and no
   * single number fixes both — so the level follows the rate.
   */
  readonly duck: AudioConfig['ground']['duck'];
}

interface ScheduledVoice {
  readonly event: PublicEvent;
  readonly endsAt: number;
  readonly salience: number;
  /** The per-event chain, released once the gesture is over. */
  readonly nodes: readonly { dispose: () => void }[];
}

export class AudioEngine {
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly highShelf: Tone.Filter;
  private readonly trim: Tone.Gain;
  private readonly reverb: Tone.Reverb;
  private readonly busInput: Tone.Gain;
  private readonly voices: Voice[] = [];
  private active: ScheduledVoice[] = [];
  /** Finished or stolen gestures, awaiting release once the context has passed them. */
  private retired: ScheduledVoice[] = [];
  private stolen = 0;
  /** When the Ground's trim was last written, and to what. See `tickDensity`. */
  private duckAt = 0;
  private duckLevel = 1;
  private recentEvents: number[] = [];
  private readonly groundTrim: Tone.Gain;
  private palette: { rootMidi: number; scale: readonly number[] };

  constructor(private readonly options: EngineOptions) {
    this.palette = { rootMidi: options.rootMidi, scale: options.scale };
    // Master chain:
    //
    //   voices (voices_gain_db) → high-shelf → compressor ┐
    //                                       Ground (§6.1) ┼→ trim (gain_db) → limiter → out
    //
    // §6.8's rules are enforced structurally rather than by convention:
    //  - the limiter is the last thing before the destination, so nothing can produce
    //    a true-peak overshoot however badly it behaves;
    //  - the high shelf tames energy above ~6 kHz, because harshness is the failure
    //    mode that makes an ambient piece unlistenable for hours.
    //
    // **The Ground used to go straight to the destination, past all of this**, and
    // that quietly broke the first of those two rules: the limiter only ever saw the
    // voices, so the *sum* of drone and voices was unguarded. It stayed legal by
    // luck while the voices were quiet and stopped the moment they were not — the
    // first render at the corrected balance measured −0.0 dBTP, over spec 7% of the
    // time, with neither band alone above −5 dB. It was the two adding up.
    //
    // So the Ground joins at the trim: after the dynamics, which are there to tame
    // voice density and have no business compressing a drone, and before the limiter,
    // which now guards what a listener actually receives. The trim moved behind the
    // compressor in the same change, because a loudness trim that cannot reach the
    // Ground cannot set the loudness of a piece the Ground dominates.
    const master = options.master;
    this.limiter = new Tone.Limiter(master.limiter_ceiling_db).toDestination();
    // The trim the lab moves to reach §6.8's loudness target.
    this.trim = new Tone.Gain(Tone.dbToGain(master.gain_db)).connect(this.limiter);
    // The Ground's own trim, between it and the master trim, so the bed can follow
    // the event rate without the voices moving with it (see `tickDensity`).
    this.groundTrim = new Tone.Gain(1).connect(this.trim);
    this.compressor = new Tone.Compressor({
      threshold: master.compressor_threshold_db,
      ratio: master.compressor_ratio,
      attack: master.compressor_attack_s,
      release: master.compressor_release_s,
    }).connect(this.trim);
    this.highShelf = new Tone.Filter({
      type: 'highshelf',
      frequency: master.high_shelf_hz,
      gain: master.high_shelf_db,
    }).connect(this.compressor);
    // Every event voice, dry and reverberant alike, passes through here — and the
    // Ground does not, because it goes straight to the destination. So this one
    // number is "how far forward the city sits against the drone", which
    // docs/music/decisions.md has had open as the question only ears can answer.
    //
    // Measured before it existed: the voice band sat 15 dB under the drone band, and
    // 93% of the piece's tonal energy was the drone's own root and fifth. That is the
    // Ground being the subject, the one thing §6.1 says it must never be.
    this.busInput = new Tone.Gain(Tone.dbToGain(master.voices_gain_db)).connect(this.highShelf);
    // NOTE on determinism: Tone.Reverb generates its impulse response from noise
    // produced with Math.random, so a render including it is NOT bit-identical.
    // The lab's deterministic preset therefore omits reverb; see lab/render.ts and
    // docs/decisions.md. This is why reverb is created here but bypassable.
    //
    // Into the voices bus rather than past it: a send that skipped the bus would
    // make every raise of the voices a drop in the wet/dry ratio, so "forward" would
    // silently also mean "drier".
    this.reverb = new Tone.Reverb({ decay: master.reverb_decay_s, wet: 1 }).connect(this.busInput);
  }

  /**
   * Move to another palette (§6.2).
   *
   * New events use it immediately; sounding ones are left alone, because retuning a
   * note in flight is the one thing a listener would certainly notice. §6.2 asks for
   * a crossfade over 5–10 minutes and this is its first half — the Ground's own
   * transition is ramped by the caller.
   */
  setPalette(palette: { rootMidi: number; scale: readonly number[] }): void {
    this.palette = palette;
  }

  register(voice: Voice): void {
    this.voices.push(voice);
  }

  get bpm(): number {
    return this.options.bpm;
  }

  get secondsPerBeat(): number {
    return 60 / this.options.bpm;
  }

  /** Voices stolen so far, reported to the lab so the budget can be measured. */
  get stolenCount(): number {
    return this.stolen;
  }

  get activeCount(): number {
    return this.active.length;
  }

  /**
   * Where the Ground connects (§6.1, §6.8).
   *
   * Past the voice dynamics and into the limiter, so the drone is not compressed by
   * a stage that exists to tame event density, but is covered by the ceiling that
   * exists to protect the listener.
   */
  /**
   * Where the Ground connects: through its own trim, which follows the event rate.
   *
   * The automation lives here rather than in `Ground` because this is where every
   * event is already seen, and because it has to behave identically in an offline
   * render — where nothing but `schedule` ever runs — and on a page, where the frame
   * loop calls `tickDensity`.
   */
  get groundDestination(): Tone.InputNode {
    return this.groundTrim;
  }

  /**
   * Move the Ground's trim up to `at`, in half-second steps.
   *
   * Called from `schedule` so a render needs nothing else, and from the client's
   * frame loop so that a long gap with no events still brings the bed down. Stepping
   * rather than jumping keeps the automation monotonic in time, which is what an
   * offline AudioParam requires.
   */
  tickDensity(at: number): void {
    const duck = this.options.duck;
    if (duck.db >= 0) return;
    const step = 0.5;
    // A page left open all night must not walk a thousand steps on its first event.
    if (at - this.duckAt > 120) this.duckAt = at - step;
    while (this.duckAt + step <= at) {
      const now = this.duckAt + step;
      const cutoff = now - duck.window_s;
      this.recentEvents = this.recentEvents.filter((time) => time > cutoff);
      const rate = (this.recentEvents.length * 60) / duck.window_s;
      const reach = Math.min(1, rate / duck.full_per_minute);
      const target = 10 ** ((duck.db * (1 - reach)) / 20);
      const seconds = target > this.duckLevel ? duck.rise_s : duck.fall_s;
      // One ramp per step, each starting where the last ended: the param's timeline
      // stays in order, which `linearRampToValueAtTime` needs and an offline context
      // does not forgive.
      this.groundTrim.gain.linearRampToValueAtTime(target, now + seconds);
      this.duckLevel = target;
      this.duckAt = now;
    }
  }

  /** Disable reverb, for deterministic offline renders. */
  async prepare(options: { withReverb: boolean }): Promise<void> {
    if (options.withReverb) await this.reverb.generate();
  }

  /**
   * Schedule one event.
   *
   * Returns false when the event was dropped by the voice budget — the lab counts
   * those, because a piece that silently drops a third of its events is a different
   * piece from the one the numbers describe.
   */
  schedule(event: PublicEvent, playAt: number): boolean {
    this.releaseFinished();
    // Before anything else, so the bed is already where it should be when this
    // event sounds — and so a render, which calls nothing else, still gets the
    // whole envelope.
    this.recentEvents.push(playAt);
    this.tickDensity(playAt);
    // The voice budget is about overlap at the moment the gesture sounds, so it is
    // counted against `playAt` — not against the context clock.
    for (const scheduled of this.active) {
      if (scheduled.endsAt <= playAt) this.retired.push(scheduled);
    }
    this.active = this.active.filter((scheduled) => scheduled.endsAt > playAt);

    if (this.active.length >= this.options.maxVoices && !this.steal(event, playAt)) {
      return false;
    }

    const voice = this.voices.find((candidate) => candidate.handles(event));
    if (voice === undefined) return false;

    const mix = distanceToMix(event.rel.distance_km);
    const panner = new Tone.Panner(bearingToPan(event.rel.bearing_deg));
    const tone = new Tone.Filter({ type: 'lowpass', frequency: mix.cutoffHz });
    // §6.5: a demoted event is the same event, played as texture rather than voice.
    // The reduction is config, because how far back "back" is, is an aesthetic
    // question the music director has to be able to answer.
    const tier = event.tier === 'texture' ? this.options.textureGain : 1;
    const gain = new Tone.Gain(mix.gain * (0.4 + 0.6 * event.salience) * tier);
    // Farther is quieter, darker AND wetter (§6.4) — the third of those was built
    // and then never connected, so distance read as "quiet and muffled" rather than
    // "far away". The send is per event because the reverb is shared.
    const send = new Tone.Gain(mix.reverbSend);
    panner.connect(tone);
    tone.connect(gain);
    gain.connect(this.busInput);
    gain.connect(send);
    send.connect(this.reverb);

    const context: VoiceContext = {
      playAt,
      // Per-event seeding so jitter does not depend on arrival order (§5).
      random: randomForEvent(this.options.sectionSeed, event.id),
      scale: this.palette.scale,
      rootMidi: this.palette.rootMidi,
      secondsPerBeat: this.secondsPerBeat,
    };
    // Whatever the voice builds is released with the chain it was built for. See
    // `VoiceOutput.own` for the leak this replaced.
    const nodes: { dispose: () => void }[] = [panner, tone, gain, send];
    const output: VoiceOutput = {
      destination: panner,
      own: (node) => {
        nodes.push(node);
      },
    };

    const duration = voice.schedule(event, context, output);
    this.active.push({
      event,
      endsAt: playAt + duration,
      salience: event.salience,
      nodes,
    });
    return true;
  }

  /**
   * Release the chains of gestures the **context clock** has passed.
   *
   * Against the context clock and not the scheduled time, and the difference is not
   * academic: in an offline render every event is scheduled synchronously before a
   * single sample exists, so releasing on scheduled time disposed each chain moments
   * after it was built and the first render of the real voices came out silent. Live,
   * `Tone.now()` advances with the music and the chains are freed as they end — which
   * matters, because a page left open all afternoon builds four nodes per event.
   */
  private releaseFinished(): void {
    const now = Tone.now();
    const keep: ScheduledVoice[] = [];
    for (const scheduled of this.retired) {
      // A tail beyond the gesture's own end. Disposing a node while signal is still
      // flowing through it is itself a discontinuity, so this has to outlast both the
      // voice's own stop tail and the reverb decay behind it.
      if (scheduled.endsAt + 12 <= now) {
        for (const node of scheduled.nodes) node.dispose();
      } else {
        keep.push(scheduled);
      }
    }
    this.retired = keep;
  }

  /**
   * Voice stealing: drop the oldest, least salient active voice (SPEC §6.8).
   *
   * Refuses to steal for an event less salient than everything already sounding —
   * otherwise a burst of distant high overflights would evict the near departure a
   * listener is actually attending to.
   */
  private steal(incoming: PublicEvent, now: number): boolean {
    let worstIndex = -1;
    let worstScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.active.length; i += 1) {
      const candidate = this.active[i];
      if (candidate === undefined) continue;
      // A demoted event is always a better victim than a promoted one, whatever its
      // raw salience: the governor has already decided it is not the subject.
      const tierPenalty = candidate.event.tier === 'texture' ? 1 : 0;
      const score = candidate.salience - tierPenalty - (now - candidate.endsAt) * 0.001;
      if (score < worstScore) {
        worstScore = score;
        worstIndex = i;
      }
    }
    if (worstIndex === -1 || worstScore >= incoming.salience) return false;
    const [victim] = this.active.splice(worstIndex, 1);
    // Stealing frees a budget slot; it does not cut the sound off. Disposing the
    // chain here would silence a sounding note instantly, which is a click — exactly
    // the sudden transient §6.8 forbids. It is retired instead and released when it
    // has finished of its own accord.
    if (victim !== undefined) this.retired.push(victim);
    this.stolen += 1;
    return true;
  }

  dispose(): void {
    for (const voice of this.voices) voice.dispose();
    this.busInput.dispose();
    this.reverb.dispose();
    this.highShelf.dispose();
    this.compressor.dispose();
    this.limiter.dispose();
  }
}
