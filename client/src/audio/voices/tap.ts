/**
 * The listener's own voice. SPEC §8, §6.4.
 *
 * Struck, always — a tap is something a person did at an instant, and a voice with a
 * slow attack would arrive after the finger had left. Three families by where the
 * screen was touched: bells at the top, a mallet in the middle, a soft wooden piano
 * at the bottom.
 *
 * The pitch is a **scale degree**, chosen on the server, so a tap can never be a
 * wrong note however the palette has moved since (§6.2, §8).
 */

import * as Tone from 'tone';
import type { AudioConfig } from '../../../../shared/protocol.js';
import {
  scaleDegreeToMidi,
  type PublicEvent,
  type Voice,
  type VoiceContext,
  type VoiceOutput,
} from '../types.js';

export class TapVoice implements Voice {
  readonly name = 'tap';

  constructor(private readonly audio: AudioConfig) {}

  handles(event: PublicEvent): boolean {
    return event.type === 'tap';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.tap;
    const tap = event.tap ?? { degree: 0, register: 1, department: null };
    const register = Math.min(params.harmonicity.length - 1, Math.max(0, tap.register));

    const midi =
      scaleDegreeToMidi(context.rootMidi, context.scale, tap.degree) +
      (params.octave_offset[register] ?? 0) * 12;

    const synth = new Tone.FMSynth({
      harmonicity: params.harmonicity[register] ?? 2,
      modulationIndex: params.modulation_index[register] ?? 6,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: {
        attack: Math.max(this.audio.voices.min_attack_s, params.attack_s),
        decay: params.decay_s,
        sustain: 0,
        release: params.release_s,
      },
      modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.4 },
      volume: Tone.gainToDb(params.gain),
    });
    synth.connect(output.destination as Tone.InputNode);
    output.own(synth);

    // Quantised like everything else (§6.3), so another listener's tap lands with the
    // music rather than beside it — but on the nearest half-beat rather than the next
    // one, because a tap that waits is a tap that feels broken.
    const step = context.secondsPerBeat * this.audio.transport.quantize_beats;
    const at = Math.round(context.playAt / step) * step;
    synth.triggerAttackRelease(
      Tone.Frequency(midi, 'midi').toFrequency(),
      params.decay_s,
      Math.max(at, context.playAt - step / 2),
    );
    return params.decay_s + params.release_s;
  }

  dispose(): void {
    // Nothing to release: the synth is handed to `output.own` and disposed with the
    // event's own chain by the engine. Keeping a list here leaked one node per event.
  }
}
