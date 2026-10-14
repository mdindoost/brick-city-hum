/**
 * Rail voices. SPEC §6.4: "each line has its own bell or chime pitch set. Arrivals =
 * struck note; departures = the same note with a short decay tail."
 *
 * A bell is the whole point of putting rail in before the other sources. The aircraft
 * voices are all sustained — figures, drones, flutters — and a city made only of
 * sustained tones has no punctuation. A struck sound gives the ear something to count
 * time by, which is what the first listening round found missing as much as density.
 *
 * FM with a non-integer harmonicity ratio produces inharmonic partials, which is what
 * makes a bell a bell rather than a sine with a fast attack. Kept mild, because the
 * same trick at a higher index is a glass shard and §6.8 forbids that kind of
 * harshness outright.
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

export class RailVoice implements Voice {
  readonly name = 'path';
  private readonly nodes: { dispose: () => void }[] = [];

  constructor(private readonly audio: AudioConfig) {}

  handles(event: PublicEvent): boolean {
    return event.type === 'path_approaching' || event.type === 'path_arrival';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.path;
    const approaching = event.type === 'path_approaching';

    // A station does not move and has no altitude, so the pitch cannot come from the
    // data the way an aircraft's does. It comes from the scale's root instead: the
    // bell is the harmonic anchor the aircraft figures move around.
    const degree = approaching ? 2 : 0;
    const midi =
      scaleDegreeToMidi(context.rootMidi, context.scale, degree) +
      (approaching ? params.approach_octave * 12 : 0);

    const synth = new Tone.FMSynth({
      harmonicity: params.harmonicity,
      modulationIndex: params.modulation_index,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: {
        attack: Math.max(this.audio.voices.min_attack_s, params.attack_s),
        decay: params.decay_s,
        sustain: 0,
        release: params.release_s,
      },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.4 },
      volume: Tone.gainToDb(approaching ? params.approach_gain : params.arrival_gain),
    });
    synth.connect(output.destination as Tone.InputNode);
    this.nodes.push(synth);

    // Struck on the beat, not on the grid's next subdivision: a bell that lands with
    // the pulse is what makes the aircraft figures feel placed rather than scattered.
    const beat = context.secondsPerBeat;
    const at = Math.ceil(context.playAt / beat) * beat;
    synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), params.decay_s, at);
    return params.decay_s + params.release_s;
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
    this.nodes.length = 0;
  }
}
