/**
 * The Ground layer. SPEC §6.1, §6.7.
 *
 * The air of the city: always there, never the subject. It is what keeps the piece
 * from being a sequence of isolated events with silence between them, and it is the
 * first thing a listener hears after ▶ — so it fades in over several seconds rather
 * than arriving.
 *
 * **It is a recording of a bowed contrabass, not an oscillator** (§6.9). That change
 * came from Mohammad, after four rounds in which the thing he kept calling background
 * noise survived every change to the voices: "I think that background noise is there
 * because you are synthesising it." He was right, and the reason is specific — the bed
 * was three triangle oscillators at 73 and 110 Hz behind a 420 Hz lowpass, and a
 * filtered triangle that low is not a drone, it is the sound of a transformer. There
 * is no attack in it, no bow, no breath, nothing a body did.
 *
 * *Music for Airports* itself, which §6.7.1 cites for the loop technique, is tape
 * loops of recorded voices and piano. The oscillators were never the faithful reading.
 *
 * The sampled bed is built the same way those tapes were: one long bowed note per
 * voice, re-entered before the last entry has faded, so the sound is continuous and
 * has no loop point at all. Entry periods differ per note because the recordings do,
 * which is one more incommensurate length on top of §6.7.1's.
 *
 * `source: oscillator` in `score.yaml` keeps the old bed, for the A/B and as the
 * fallback when the kit has not loaded.
 *
 * Its other structural trick is §6.7.1, the technique behind *Music for Airports*:
 * each tone breathes on a loop of a different, mutually prime length, so the
 * combination does not repeat until the product of those lengths. With 17, 23 and 31
 * seconds that is about three and a half hours — longer than anyone will listen in
 * one sitting, which is the point. A single shared period, however slow, is audible
 * as a pulse within minutes.
 */

import * as Tone from 'tone';
import type { AudioConfig } from '../../../shared/protocol.js';
import type { SampleKit } from './samples.js';

export interface GroundOptions {
  /** The CC0 kits. Without the one `ground.instrument` names, the bed is oscillators. */
  readonly kits?: Map<string, SampleKit>;
  /** How far ahead to schedule entries. The lab passes the render's own length. */
  readonly seconds?: number;
  /** Keep scheduling beyond `seconds`. False in an offline render, which ends. */
  readonly refill?: boolean;
}

/**
 * The gain shape of one entry: equal power in, flat, equal power out.
 *
 * Sampled rather than ramped because the Web Audio API has no sine ramp — and
 * because the curve is the part that must be exactly right. Two overlapping entries
 * are the same recording at different offsets, so they are uncorrelated and their
 * **powers** add: `sin²+cos² = 1` holds the bed flat, while the linear fade it
 * replaced dropped it 3 dB at every handover.
 */
function equalPowerWindow(bodySeconds: number, swellSeconds: number, points = 256): number[] {
  const curve: number[] = new Array<number>(points);
  for (let index = 0; index < points; index += 1) {
    const at = (index / (points - 1)) * bodySeconds;
    const rising = Math.min(1, at / swellSeconds);
    const falling = Math.min(1, (bodySeconds - at) / swellSeconds);
    curve[index] = Math.sin((Math.PI / 2) * Math.min(rising, falling));
  }
  return curve;
}

export class Ground {
  private readonly nodes: { dispose: () => void }[] = [];
  private readonly filters: Tone.Filter[] = [];
  private master: Tone.Gain | null = null;
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly audio: AudioConfig) {}

  /**
   * Build and start. `at` is in context seconds, like everything else in the audio
   * path — never a wall clock (§9.4).
   */
  start(destination: Tone.InputNode, at: number, options: GroundOptions = {}): void {
    const ground = this.audio.ground;
    const kit = options.kits?.get(ground.instrument);
    if (ground.source === 'sample' && kit !== undefined) {
      this.startSampled(destination, at, kit, options);
      return;
    }
    const master = new Tone.Gain(0);
    master.connect(destination);
    this.master = master;
    this.nodes.push(master);

    ground.midi.forEach((midi, index) => {
      const loopSeconds = ground.loop_s[index % ground.loop_s.length] ?? 17;
      const sweepSeconds = ground.lfo_s[index % ground.lfo_s.length] ?? 43;

      const oscillator = new Tone.Oscillator({
        frequency: Tone.Frequency(midi, 'midi').toFrequency(),
        type: 'triangle',
      });
      const filter = new Tone.Filter({ type: 'lowpass', frequency: ground.cutoff_hz, Q: 0.7 });
      const level = new Tone.Gain(1 / ground.midi.length);

      // Breath: a slow sine between half and full level, never silent, so the layer
      // moves without ever drawing attention to a beginning or an end.
      const breath = new Tone.LFO({
        frequency: 1 / loopSeconds,
        min: 0.5 / ground.midi.length,
        max: 1 / ground.midi.length,
      });
      breath.connect(level.gain);

      // Colour: the cutoff drifts on a different prime period, so timbre and level
      // never peak together (§6.7.2).
      const colour = new Tone.LFO({
        frequency: 1 / sweepSeconds,
        min: ground.cutoff_hz - ground.cutoff_sweep_hz,
        max: ground.cutoff_hz + ground.cutoff_sweep_hz,
      });
      colour.connect(filter.frequency);

      oscillator.connect(filter);
      filter.connect(level);
      level.connect(master);
      this.nodes.push(oscillator, filter, level, breath, colour);
      this.filters.push(filter);

      oscillator.start(at);
      breath.start(at);
      colour.start(at);
    });

    // §6.8: no sudden transients, and this one would be the loudest of all — the
    // whole bed arriving at once the moment someone presses play.
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(ground.gain, at + ground.attack_s);
  }

  /**
   * The sampled bed: one long bowed note per voice, re-entered before it has gone.
   *
   * No loop point anywhere. Each entry plays the whole recording once with a
   * `swell_s` fade at each end, and the next entry starts `body − swell_s` later, so
   * one is always rising while the other falls. A looped buffer would have been
   * simpler and would put a seam in the bed every few seconds — on a bowed note that
   * is a click, and §6.8 forbids exactly that.
   *
   * The filter, its sweep and the breathing LFO are the same ones the oscillator bed
   * uses, which is why `retune` needs to know nothing about either.
   */
  private startSampled(
    destination: Tone.InputNode,
    at: number,
    kit: SampleKit,
    options: GroundOptions,
  ): void {
    const ground = this.audio.ground;
    const master = new Tone.Gain(0);
    master.connect(destination);
    this.master = master;
    this.nodes.push(master);

    const horizon = options.seconds ?? 300;

    ground.midi.forEach((midi, index) => {
      const loopSeconds = ground.loop_s[index % ground.loop_s.length] ?? 17;
      const sweepSeconds = ground.lfo_s[index % ground.lfo_s.length] ?? 43;

      const filter = new Tone.Filter({ type: 'lowpass', frequency: ground.cutoff_hz, Q: 0.7 });
      const level = new Tone.Gain(1 / ground.midi.length);

      const breath = new Tone.LFO({
        frequency: 1 / loopSeconds,
        min: 0.5 / ground.midi.length,
        max: 1 / ground.midi.length,
      });
      breath.connect(level.gain);
      const colour = new Tone.LFO({
        frequency: 1 / sweepSeconds,
        min: ground.cutoff_hz - ground.cutoff_sweep_hz,
        max: ground.cutoff_hz + ground.cutoff_sweep_hz,
      });
      colour.connect(filter.frequency);

      filter.connect(level);
      level.connect(master);
      this.nodes.push(filter, level, breath, colour);
      this.filters.push(filter);
      breath.start(at);
      colour.start(at);

      const { buffer, semitones } = kit.pick(midi);
      const rate = 2 ** (semitones / 12);
      const span = buffer.duration / rate;
      // Part of the recording is held back so that consecutive entries can start at
      // different points in it. Without that, the bed is one five-second phrase
      // played over and over — the loop §6.7.1 is written to avoid, rebuilt out of
      // samples instead of oscillators.
      const rotate = Math.min(ground.rotate_s, span / 3);
      const body = span - rotate;
      // Two swells have to fit inside one entry, or the fades would overlap each
      // other and the note would never reach full level.
      const swell = Math.min(ground.swell_s, body / 2.5);
      // Each note's own recording decides its period, so the two never share one.
      const period = Math.max(1, body - swell);

      // An equal-power window, not a linear one.
      //
      // Tone's own fades are linear or exponential, and both are wrong here: two
      // entries of the same recording at different offsets are uncorrelated, so
      // their powers add rather than their amplitudes, and a linear crossfade drops
      // the bed by 3 dB at every handover. On the bed-only spectrogram that is a
      // dark vertical stripe every ten seconds — a pulse, which is the one thing
      // §6.7.1 exists to prevent. `sin`/`cos` keeps the sum flat.
      const window = equalPowerWindow(body, swell);

      const schedule = (from: number, until: number): void => {
        for (let entry = from; entry < until; entry += period) {
          // Which part of the recording this entry plays. The golden ratio because
          // it is the least periodic rotation there is, and a fixed one because §5
          // forbids a listener hearing a different bed from everyone else — this is
          // determined by the entry's index and nothing else.
          const step = Math.round((entry - at) / period);
          const offset = (((step * 0.6180339887) % 1) + 1) % 1;
          const source = new Tone.ToneBufferSource({ url: buffer, playbackRate: rate });
          const shape = new Tone.Gain(0);
          source.connect(shape);
          shape.connect(filter);
          shape.gain.setValueCurveAtTime(window, entry, body);
          source.start(entry, offset * rotate * rate, body);
          this.nodes.push(source, shape);
        }
      };
      schedule(at, at + horizon);

      if (options.refill === true) {
        // A page left open all day cannot have its whole bed scheduled at the start,
        // and the refill must still compute every entry from the context clock —
        // `setInterval` decides only *when to think about it*, never when a note
        // sounds (§9.4).
        let scheduled = at + horizon;
        this.refillTimer = setInterval(
          () => {
            const until = Tone.now() + horizon;
            if (until <= scheduled) return;
            // Keep the grid: entries stay on `at + k × period` for ever.
            const next = at + Math.ceil((scheduled - at) / period) * period;
            schedule(next, until);
            scheduled = until;
          },
          Math.max(5, horizon / 3) * 1000,
        );
      }
    });

    // §6.8: no sudden transients, and this one would be the loudest of all — the
    // whole bed arriving at once the moment someone presses play.
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(ground.gain, at + ground.attack_s);
  }

  /**
   * Move the bed to another palette (§6.2).
   *
   * Only the brightness and the level move, and slowly: retuning the drone would be a
   * key change in the middle of a piece that has no cadence to justify one. The pitch
   * follows at the next natural boundary, which Phase 2's sections provide.
   */
  retune(cutoffHz: number, gain: number, at: number, seconds: number): void {
    this.master?.gain.linearRampToValueAtTime(gain, at + seconds);
    for (const filter of this.filters) {
      filter.frequency.linearRampToValueAtTime(cutoffHz, at + seconds);
    }
  }

  /** Fade out and release. Used when the listener pauses. */
  stop(at: number, fadeSeconds = 2): void {
    this.master?.gain.linearRampToValueAtTime(0, at + fadeSeconds);
  }

  dispose(): void {
    if (this.refillTimer !== null) clearInterval(this.refillTimer);
    this.refillTimer = null;
    for (const node of this.nodes) node.dispose();
    this.nodes.length = 0;
    this.filters.length = 0;
    this.master = null;
  }
}
