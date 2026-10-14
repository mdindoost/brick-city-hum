/**
 * The probe voice — a MEASUREMENT FIXTURE, NOT MUSIC.
 *
 * Read `docs/music/decisions.md` before touching this file.
 *
 * It exists for two reasons, neither of them aesthetic:
 *
 *  1. Phase 0 must prove the chain recording → replay → render → LUFS → spectrogram
 *     → report actually works, and SPEC §13 gates on that. The audio engine arrives
 *     in Phase 1, so without something to render there is nothing to measure — and
 *     debugging a headless-Chromium `Tone.Offline` harness is far easier when the
 *     only thing playing is one bell.
 *  2. Afterwards it stays as the renderer's **regression fixture**: a known-hash
 *     check that answers "did the renderer change, or did the music change?" when
 *     something sounds wrong months from now.
 *
 * **It will sound bad. That is not a defect, and it must never be tuned.** Do not
 * propose changes to it, do not read its lab numbers as an aesthetic signal, and do
 * not cite it in an A/B comparison. If its output changes, the renderer changed —
 * which is the entire point of keeping it.
 *
 * It is excluded from the production client bundle: nothing under `client/` imports it.
 */

import * as Tone from 'tone';
import {
  altitudeToSemitones,
  scaleDegreeToMidi,
  type PublicEvent,
  type Voice,
  type VoiceContext,
  type VoiceOutput,
} from '../../client/src/audio/types.js';
import { humanise } from '../../client/src/audio/random.js';

/**
 * One bell per event, pitched by scale degree and altitude, panned by bearing (the
 * engine does the panning). The first implementation of the event→voice interface
 * every Phase 1 voice will implement — which is the other half of why it exists: an
 * interface with one real implementation is an interface that has been tested.
 */
export class ProbeVoice implements Voice {
  readonly name = 'probe';
  private readonly synths: Tone.Synth[] = [];

  handles(): boolean {
    return true;
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        // §6.8: minimum ~5 ms attack. No voice, not even a throwaway, may produce a
        // sudden transient — that is the rule that protects a listener's ears.
        attack: 0.012,
        decay: 0.35,
        sustain: 0.1,
        release: 1.2,
      },
    });
    synth.connect(output.destination as Tone.InputNode);
    this.synths.push(synth);

    // Pitch: a scale degree chosen from the event, raised with altitude. Quantised
    // to the current scale, so §6.2's "no wrong notes, ever" holds even here.
    const degree = Math.floor(context.random() * context.scale.length);
    const midi =
      scaleDegreeToMidi(context.rootMidi, context.scale, degree) +
      altitudeToSemitones(event.geo.alt_ft);
    const frequency = Tone.Frequency(Math.min(108, Math.max(24, midi)), 'midi').toFrequency();

    // Humanised timing (§6.7 point 4), from the seeded PRNG so a render reproduces.
    const at = context.playAt + humanise(context.random, 18);
    const duration = event.attrs.heavy ? context.secondsPerBeat * 2 : context.secondsPerBeat;
    synth.triggerAttackRelease(frequency, duration, Math.max(0, at), 0.5);

    return duration + 1.2;
  }

  dispose(): void {
    for (const synth of this.synths) synth.dispose();
    this.synths.length = 0;
  }
}

/**
 * A single sustained drone, so the render is never digital silence.
 *
 * Stands in for the Ground layer (§6.1) only so that loudness and spectrogram
 * measurements have a continuous bed to measure. It is not a design for that layer.
 */
export class ProbeDrone {
  private synth: Tone.Oscillator | undefined;

  start(rootMidi: number, destination: Tone.InputNode, atSeconds = 0): void {
    this.synth = new Tone.Oscillator({
      frequency: Tone.Frequency(rootMidi - 24, 'midi').toFrequency(),
      type: 'sine',
      volume: -26,
    });
    this.synth.connect(destination);
    this.synth.start(atSeconds);
  }

  dispose(): void {
    this.synth?.dispose();
    this.synth = undefined;
  }
}
