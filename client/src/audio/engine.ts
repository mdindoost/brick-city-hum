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

  constructor(private readonly options: EngineOptions) {
    // Master chain, in order: bus → high-shelf → compressor → limiter → out.
    //
    // §6.8's rules are enforced structurally rather than by convention:
    //  - the limiter is the last thing before the destination, at −1 dBTP, so no
    //    voice can produce a true-peak overshoot however badly it behaves;
    //  - the high shelf tames energy above ~6 kHz, because harshness is the
    //    failure mode that makes an ambient piece unlistenable for hours.
    const master = options.master;
    this.limiter = new Tone.Limiter(master.limiter_ceiling_db).toDestination();
    this.compressor = new Tone.Compressor({
      threshold: master.compressor_threshold_db,
      ratio: master.compressor_ratio,
      attack: master.compressor_attack_s,
      release: master.compressor_release_s,
    }).connect(this.limiter);
    // The trim the lab moves to reach §6.8's loudness target, ahead of the dynamics
    // so raising it does not change how the compressor behaves on the balance.
    this.trim = new Tone.Gain(Tone.dbToGain(master.gain_db)).connect(this.compressor);
    this.highShelf = new Tone.Filter({
      type: 'highshelf',
      frequency: master.high_shelf_hz,
      gain: master.high_shelf_db,
    }).connect(this.trim);
    // NOTE on determinism: Tone.Reverb generates its impulse response from noise
    // produced with Math.random, so a render including it is NOT bit-identical.
    // The lab's deterministic preset therefore omits reverb; see lab/render.ts and
    // docs/decisions.md. This is why reverb is created here but bypassable.
    this.reverb = new Tone.Reverb({ decay: master.reverb_decay_s, wet: 1 }).connect(this.highShelf);
    this.busInput = new Tone.Gain(1).connect(this.highShelf);
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
      scale: this.options.scale,
      rootMidi: this.options.rootMidi,
      secondsPerBeat: this.secondsPerBeat,
    };
    const output: VoiceOutput = { destination: panner };

    const duration = voice.schedule(event, context, output);
    this.active.push({
      event,
      endsAt: playAt + duration,
      salience: event.salience,
      nodes: [panner, tone, gain, send],
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
