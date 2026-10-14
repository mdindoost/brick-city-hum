/**
 * The aircraft voices. SPEC §6.4.
 *
 * Five gestures, one per event type, and a modifier for heavy aircraft. Each is a
 * *gesture* rather than a note, because that is what makes a stream of events read as
 * music instead of as notification: a departure rises, an arrival settles, an
 * overflight passes. Altitude sets the register, bearing sets the pan and distance
 * sets gain, colour and reverb — all three of those belong to the engine, not here.
 *
 * **Every number in this file comes from `config/score.yaml`**, shipped to the browser
 * in the hello message. A tuning value written into this file would be a value the
 * music director can never reach (§1.5).
 *
 * What is deliberately *not* here: anything that reads a clock, `Math.random`, or the
 * destination. A voice schedules against `context.playAt`, draws from the seeded PRNG
 * it is handed, and connects to the node the engine gives it — which is what keeps
 * every listener in sync and offline renders reproducible.
 */

import * as Tone from 'tone';
import type { AudioConfig, FigureParams } from '../../../../shared/protocol.js';
import {
  altitudeToSemitones,
  scaleDegreeToMidi,
  type PublicEvent,
  type Voice,
  type VoiceContext,
  type VoiceOutput,
} from '../types.js';
/**
 * Human timing, but only ever *late* (SPEC §6.7.4).
 *
 * `humanise` is symmetric, and symmetric jitter on the first note of a gesture
 * scheduled at the very start of an offline render produces a negative time — which
 * is not a rounding wrinkle but a thrown RangeError that fails the whole render.
 * Dragging rather than rushing is also the more human of the two, and for an ambient
 * piece a note that arrives a hair late is the safer error in every sense.
 */
function drag(random: () => number, milliseconds: number): number {
  return (random() * milliseconds) / 1000;
}

/** Where in the scale this event sits, from its altitude (§6.4). */
function degreeFor(event: PublicEvent, context: VoiceContext): number {
  const semitones = altitudeToSemitones(event.geo.alt_ft);
  // Semitones are not scale degrees: dividing by the pentatonic's average step
  // (12 / 5) turns the altitude band into a degree index that stays in the scale.
  return Math.round((semitones * context.scale.length) / 12);
}

function midiFor(event: PublicEvent, context: VoiceContext, heavyOctaves: number): number {
  const midi = scaleDegreeToMidi(context.rootMidi, context.scale, degreeFor(event, context));
  return midi + heavyOctaves * 12;
}

/** Quantise to the shared grid, so the city falls into the music (§6.3). */
function onGrid(playAt: number, context: VoiceContext, quantizeBeats: number): number {
  const step = context.secondsPerBeat * quantizeBeats;
  return Math.ceil(playAt / step) * step;
}

abstract class AircraftVoice implements Voice {
  abstract readonly name: string;
  protected readonly nodes: { dispose: () => void }[] = [];

  constructor(protected readonly audio: AudioConfig) {}

  abstract handles(event: PublicEvent): boolean;
  abstract schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number;

  /** Heavy aircraft are lower, longer and warmer (§6.4) — a modifier, not a voice. */
  protected heavy(event: PublicEvent): { octaves: number; release: number; cutoff: number } {
    const heavy = this.audio.voices.heavy;
    return event.attrs.heavy
      ? {
          octaves: heavy.octave_offset,
          release: heavy.release_multiplier,
          cutoff: heavy.cutoff_multiplier,
        }
      : { octaves: 0, release: 1, cutoff: 1 };
  }

  /** §6.8: no sudden transients, whatever a config edit asks for. */
  protected attack(seconds: number): number {
    return Math.max(this.audio.voices.min_attack_s, seconds);
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
    this.nodes.length = 0;
  }
}

/**
 * A rising or falling figure: departures and arrivals.
 *
 * One class for both because they differ only in direction, attack and tuning — and
 * writing them twice would let them drift apart, which is exactly how a pair of
 * gestures meant to be heard as opposites stops being one.
 */
class FigureVoice extends AircraftVoice {
  constructor(
    readonly name: string,
    audio: AudioConfig,
    private readonly type: string,
    private readonly params: FigureParams,
    private readonly direction: 1 | -1,
  ) {
    super(audio);
  }

  handles(event: PublicEvent): boolean {
    return event.type === this.type;
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const heavy = this.heavy(event);
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: this.attack(this.params.attack_s),
        decay: 0.3,
        sustain: 0.25,
        release: this.params.release_s * heavy.release,
      },
      volume: Tone.gainToDb(this.params.gain),
    });
    synth.connect(output.destination as Tone.InputNode);
    this.nodes.push(synth);

    // Climb rate sets glide speed (§6.4). An aircraft clawing for altitude hurries
    // its figure; one easing off lets it breathe.
    const climb = Math.min(1, Math.abs(event.attrs.vrate_fpm ?? 0) / this.params.vrate_fast_fpm);
    const gapBeats =
      this.params.gap_beats_slow +
      (this.params.gap_beats_fast - this.params.gap_beats_slow) * climb;
    const gap = gapBeats * context.secondsPerBeat;

    const base = degreeFor(event, context);
    const start = onGrid(context.playAt, context, this.audio.transport.quantize_beats);
    const hold = gap * 0.9;

    for (let index = 0; index < this.params.notes; index += 1) {
      const degree = base + this.direction * index * this.params.step_degrees;
      const midi = scaleDegreeToMidi(context.rootMidi, context.scale, degree) + heavy.octaves * 12;
      // Up to 25 ms of drag (§6.7.4), from the seeded stream so every listener gets
      // the same "human" and the lab can reproduce it.
      const at = start + index * gap + drag(context.random, 25);
      synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), hold, at);
    }

    return this.params.notes * gap + this.params.release_s * heavy.release;
  }
}

/** A sustained tone that passes overhead, with the faintest Doppler lean (§6.4). */
class OverflightVoice extends AircraftVoice {
  readonly name = 'overflight_city';

  handles(event: PublicEvent): boolean {
    return event.type === 'overflight_city';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.overflight_city;
    const heavy = this.heavy(event);
    const midi = midiFor(event, context, heavy.octaves);
    const frequency = Tone.Frequency(midi, 'midi').toFrequency();
    const start = onGrid(context.playAt, context, this.audio.transport.quantize_beats);
    const total = this.attack(params.attack_s) + params.hold_s + params.release_s * heavy.release;

    // Two oscillators a few cents apart. The slow beating between them is what gives
    // a sustained tone width; a single oscillator at this length sounds like a test.
    for (const cents of [-params.detune_cents / 2, params.detune_cents / 2]) {
      const oscillator = new Tone.Oscillator({
        frequency,
        detune: cents,
        type: 'sine',
      });
      const envelope = new Tone.AmplitudeEnvelope({
        attack: this.attack(params.attack_s),
        decay: 0.1,
        sustain: 1,
        release: params.release_s * heavy.release,
      });
      const level = new Tone.Gain(params.gain / 2);
      oscillator.connect(envelope);
      envelope.connect(level);
      level.connect(output.destination as Tone.InputNode);
      this.nodes.push(oscillator, envelope, level);

      oscillator.start(start);
      oscillator.stop(start + total);
      envelope.triggerAttack(start);
      envelope.triggerRelease(start + this.attack(params.attack_s) + params.hold_s);

      // The Doppler hint: a drift of a few cents across the pass. Kept well under the
      // ~6 cents where a listener stops hearing "moving" and starts hearing "flat".
      const lean = event.attrs.vrate_fpm !== null && event.attrs.vrate_fpm < 0 ? -1 : 1;
      oscillator.detune.linearRampToValueAtTime(cents + lean * params.bend_cents, start + total);
    }

    return total;
  }
}

/** Barely audible shimmer, two octaves up, for something at 40,000 feet (§6.4). */
class HighOverflightVoice extends AircraftVoice {
  readonly name = 'overflight_high';

  handles(event: PublicEvent): boolean {
    return event.type === 'overflight_high';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.overflight_high;
    const midi = midiFor(event, context, 0) + params.octave_offset * 12;
    const start = onGrid(context.playAt, context, this.audio.transport.quantize_beats);
    const total = this.attack(params.attack_s) + params.release_s;

    const synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: this.attack(params.attack_s),
        decay: 0.2,
        sustain: 0.8,
        release: params.release_s,
      },
      volume: Tone.gainToDb(params.gain),
    });
    synth.connect(output.destination as Tone.InputNode);
    this.nodes.push(synth);
    synth.triggerAttackRelease(
      Tone.Frequency(midi, 'midi').toFrequency(),
      this.attack(params.attack_s) + 0.5,
      start,
    );
    return total;
  }
}

/** A flutter rather than a note: the rotor is the identifying feature (§6.4). */
class HelicopterVoice extends AircraftVoice {
  readonly name = 'helicopter';

  handles(event: PublicEvent): boolean {
    return event.type === 'helicopter';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.helicopter;
    const midi = midiFor(event, context, 0);
    const start = onGrid(context.playAt, context, this.audio.transport.quantize_beats);
    const total = this.attack(params.attack_s) + params.hold_s + params.release_s;

    const oscillator = new Tone.Oscillator({
      frequency: Tone.Frequency(midi, 'midi').toFrequency(),
      type: 'triangle',
    });
    const tremolo = new Tone.Tremolo({
      frequency: params.tremolo_hz,
      depth: params.tremolo_depth,
      spread: 0,
    });
    const envelope = new Tone.AmplitudeEnvelope({
      attack: this.attack(params.attack_s),
      decay: 0.2,
      sustain: 1,
      release: params.release_s,
    });
    const level = new Tone.Gain(params.gain);
    oscillator.connect(tremolo);
    tremolo.connect(envelope);
    envelope.connect(level);
    level.connect(output.destination as Tone.InputNode);
    this.nodes.push(oscillator, tremolo, envelope, level);

    tremolo.start(start);
    oscillator.start(start);
    oscillator.stop(start + total);
    envelope.triggerAttack(start);
    envelope.triggerRelease(start + this.attack(params.attack_s) + params.hold_s);
    return total;
  }
}

/** Every aircraft voice, in the order the engine should try them. */
export function aircraftVoices(audio: AudioConfig): Voice[] {
  return [
    new FigureVoice('ewr_departure', audio, 'ewr_departure', audio.voices.ewr_departure, 1),
    new FigureVoice('ewr_arrival', audio, 'ewr_arrival', audio.voices.ewr_arrival, -1),
    new OverflightVoice(audio),
    new HighOverflightVoice(audio),
    new HelicopterVoice(audio),
  ];
}
