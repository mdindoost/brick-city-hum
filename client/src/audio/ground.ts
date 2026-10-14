/**
 * The Ground layer. SPEC §6.1, §6.7.
 *
 * The air of the city: always there, never the subject. It is what keeps the piece
 * from being a sequence of isolated events with silence between them, and it is the
 * first thing a listener hears after ▶ — so it fades in over several seconds rather
 * than arriving.
 *
 * Its only structural trick is §6.7.1, the technique behind *Music for Airports*:
 * each tone breathes on a loop of a different, mutually prime length, so the
 * combination does not repeat until the product of those lengths. With 17, 23 and 31
 * seconds that is about three and a half hours — longer than anyone will listen in
 * one sitting, which is the point. A single shared period, however slow, is audible
 * as a pulse within minutes.
 */

import * as Tone from 'tone';
import type { AudioConfig } from '../../../shared/protocol.js';

export class Ground {
  private readonly nodes: { dispose: () => void }[] = [];
  private master: Tone.Gain | null = null;

  constructor(private readonly audio: AudioConfig) {}

  /**
   * Build and start. `at` is in context seconds, like everything else in the audio
   * path — never a wall clock (§9.4).
   */
  start(destination: Tone.InputNode, at: number): void {
    const ground = this.audio.ground;
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

      oscillator.start(at);
      breath.start(at);
      colour.start(at);
    });

    // §6.8: no sudden transients, and this one would be the loudest of all — the
    // whole bed arriving at once the moment someone presses play.
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(ground.gain, at + ground.attack_s);
  }

  /** Fade out and release. Used when the listener pauses. */
  stop(at: number, fadeSeconds = 2): void {
    this.master?.gain.linearRampToValueAtTime(0, at + fadeSeconds);
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
    this.nodes.length = 0;
    this.master = null;
  }
}
