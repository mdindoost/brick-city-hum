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
}

interface ScheduledVoice {
  readonly event: PublicEvent;
  readonly endsAt: number;
  readonly salience: number;
}

export class AudioEngine {
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly highShelf: Tone.Filter;
  private readonly reverb: Tone.Reverb;
  private readonly busInput: Tone.Gain;
  private readonly voices: Voice[] = [];
  private active: ScheduledVoice[] = [];
  private stolen = 0;

  constructor(private readonly options: EngineOptions) {
    // Master chain, in order: bus → high-shelf → compressor → limiter → out.
    //
    // §6.8's rules are enforced structurally rather than by convention:
    //  - the limiter is the last thing before the destination, at −1 dBTP, so no
    //    voice can produce a true-peak overshoot however badly it behaves;
    //  - the high shelf tames energy above ~6 kHz, because harshness is the
    //    failure mode that makes an ambient piece unlistenable for hours.
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.compressor = new Tone.Compressor({
      threshold: -24,
      ratio: 2.5,
      attack: 0.05,
      release: 0.4,
    }).connect(this.limiter);
    this.highShelf = new Tone.Filter({ type: 'highshelf', frequency: 6000, gain: -6 }).connect(
      this.compressor,
    );
    // NOTE on determinism: Tone.Reverb generates its impulse response from noise
    // produced with Math.random, so a render including it is NOT bit-identical.
    // The lab's deterministic preset therefore omits reverb; see lab/render.ts and
    // docs/decisions.md. This is why reverb is created here but bypassable.
    this.reverb = new Tone.Reverb({ decay: 4, wet: 1 }).connect(this.highShelf);
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
    this.active = this.active.filter((scheduled) => scheduled.endsAt > playAt);

    if (this.active.length >= this.options.maxVoices && !this.steal(event, playAt)) {
      return false;
    }

    const voice = this.voices.find((candidate) => candidate.handles(event));
    if (voice === undefined) return false;

    const mix = distanceToMix(event.rel.distance_km);
    const panner = new Tone.Panner(bearingToPan(event.rel.bearing_deg));
    const tone = new Tone.Filter({ type: 'lowpass', frequency: mix.cutoffHz });
    const gain = new Tone.Gain(mix.gain * (0.4 + 0.6 * event.salience));
    panner.connect(tone);
    tone.connect(gain);
    gain.connect(this.busInput);

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
    this.active.push({ event, endsAt: playAt + duration, salience: event.salience });
    return true;
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
      const score = candidate.salience - (now - candidate.endsAt) * 0.001;
      if (score < worstScore) {
        worstScore = score;
        worstIndex = i;
      }
    }
    if (worstIndex === -1 || worstScore >= incoming.salience) return false;
    this.active.splice(worstIndex, 1);
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
