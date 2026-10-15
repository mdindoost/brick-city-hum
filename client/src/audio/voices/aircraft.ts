/**
 * The aircraft voices. SPEC §6.4, §6.9.
 *
 * Five gestures, one per event type, and a modifier for heavy aircraft. Each is a
 * *gesture* rather than a note, because that is what makes a stream of events read as
 * music instead of as notification: a departure rises, an arrival settles, an
 * overflight passes. Altitude sets the register, bearing sets the pan and distance
 * sets gain, colour and reverb — all three of those belong to the engine, not here.
 *
 * **Four of the five now play CC0 samples rather than oscillators.** Two listening
 * rounds were lost to the same verdict — background noise, no musical feeling, and
 * about Listen to Wikipedia, "as if someone was really playing a note". That piece
 * plays recorded samples; a sine with an envelope has no strike in it, and the
 * attack transient of a struck bar is what the ear reads as an instrument and a
 * person. See `../samples.ts` for the kits and the player.
 *
 * The helicopter is the exception and stays synthesised, because a rotor is a
 * *flutter* and no single struck sample flutters. §6.4 names the tremolo rate as the
 * identifying feature of that voice; a sample would lose exactly that.
 *
 * **Every number in this file comes from `config/score.yaml`**, shipped to the browser
 * in the hello message. A tuning value written into this file would be a value the
 * music director can never reach (§1.5).
 *
 * What is deliberately *not* here: anything that reads a clock, `Math.random`, or the
 * destination. A voice schedules against `context.playAt`, draws from the seeded PRNG
 * it is handed, and hands every node it builds to `output.own` — which is what keeps
 * every listener in sync, offline renders reproducible, and a page left open all day
 * from accumulating one audio node per event it ever played.
 */

import * as Tone from 'tone';
import type { AudioConfig, FigureParams, StruckParams } from '../../../../shared/protocol.js';
import { strike, type SampleKit } from '../samples.js';
import {
  altitudeToSemitones,
  foldToRegister,
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

/** Quantise to the shared grid, so the city falls into the music (§6.3). */
function onGrid(playAt: number, context: VoiceContext, quantizeBeats: number): number {
  const step = context.secondsPerBeat * quantizeBeats;
  return Math.ceil(playAt / step) * step;
}

abstract class AircraftVoice implements Voice {
  abstract readonly name: string;

  constructor(protected readonly audio: AudioConfig) {}

  abstract handles(event: PublicEvent): boolean;
  abstract schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number;

  /** Heavy aircraft are lower, longer and warmer (§6.4) — a modifier, not a voice. */
  protected heavy(event: PublicEvent): { octaves: number; length: number } {
    const heavy = this.audio.voices.heavy;
    return event.attrs.heavy
      ? { octaves: heavy.octave_offset, length: heavy.release_multiplier }
      : { octaves: 0, length: 1 };
  }

  /** §6.8: no sudden transients, whatever a config edit asks for. */
  protected fadeIn(seconds: number): number {
    return Math.max(this.audio.voices.min_attack_s, seconds);
  }

  /** The note this event plays, folded into the voice's own register (§6.9). */
  protected noteFor(
    event: PublicEvent,
    context: VoiceContext,
    params: StruckParams,
    heavyOctaves: number,
  ): number {
    const midi =
      scaleDegreeToMidi(context.rootMidi, context.scale, degreeFor(event, context)) +
      heavyOctaves * 12;
    return foldToRegister(midi, params.register);
  }

  dispose(): void {
    // Nothing to release: every node a sampled voice builds is handed to
    // `output.own` and disposed with the event's own chain by the engine.
  }
}

/**
 * A rising or falling figure: departures and arrivals.
 *
 * One class for both because they differ only in direction, instrument and tuning —
 * and writing them twice would let them drift apart, which is exactly how a pair of
 * gestures meant to be heard as opposites stops being one. What makes them read as
 * opposites now is mostly the kit: a marimba is dry and definite, a vibraphone rings
 * and settles.
 */
class FigureVoice extends AircraftVoice {
  constructor(
    readonly name: string,
    audio: AudioConfig,
    private readonly type: string,
    private readonly params: FigureParams,
    private readonly direction: 1 | -1,
    private readonly kit: SampleKit,
  ) {
    super(audio);
  }

  handles(event: PublicEvent): boolean {
    return event.type === this.type;
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const heavy = this.heavy(event);

    // Climb rate sets glide speed (§6.4). An aircraft clawing for altitude hurries
    // its figure; one easing off lets it breathe.
    const climb = Math.min(1, Math.abs(event.attrs.vrate_fpm ?? 0) / this.params.vrate_fast_fpm);
    const gapBeats =
      this.params.gap_beats_slow +
      (this.params.gap_beats_fast - this.params.gap_beats_slow) * climb;
    const gap = gapBeats * context.secondsPerBeat;

    const base = degreeFor(event, context);
    const start = onGrid(context.playAt, context, this.audio.transport.quantize_beats);
    const maxS = this.params.max_s * heavy.length;

    let last = 0;
    for (let index = 0; index < this.params.notes; index += 1) {
      const degree = base + this.direction * index * this.params.step_degrees;
      const midi = scaleDegreeToMidi(context.rootMidi, context.scale, degree) + heavy.octaves * 12;
      // Up to 25 ms of drag (§6.7.4), from the seeded stream so every listener gets
      // the same "human" and the lab can reproduce it.
      const at = start + index * gap + drag(context.random, 25);
      last = strike(
        {
          kit: this.kit,
          midi: foldToRegister(midi, this.params.register),
          at,
          gain: this.params.gain,
          fadeInS: this.fadeIn(this.params.fade_in_s),
          // Each note may ring until the next one, but never past the voice's own
          // ceiling: three overlapping 3.5-second vibraphone notes is a chord, and a
          // chord per arrival at forty arrivals a minute is a wash.
          maxS: Math.min(maxS, gap * 2.5),
          fadeOutS: this.params.fade_out_s,
        },
        output,
      );
      last += index * gap;
    }

    return last;
  }
}

/** A bell that passes overhead, with the faintest Doppler lean (§6.4). */
class OverflightVoice extends AircraftVoice {
  readonly name = 'overflight_city';

  constructor(
    audio: AudioConfig,
    private readonly kit: SampleKit,
  ) {
    super(audio);
  }

  handles(event: PublicEvent): boolean {
    return event.type === 'overflight_city';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.overflight_city;
    const heavy = this.heavy(event);
    // Climbing leans the pitch up across the pass, descending leans it down — which
    // is the wrong way round for a true Doppler and the right way round for the ear,
    // because what a listener on the ground actually tracks is the aircraft getting
    // away from them.
    const lean = event.attrs.vrate_fpm !== null && event.attrs.vrate_fpm < 0 ? -1 : 1;
    return strike(
      {
        kit: this.kit,
        midi: this.noteFor(event, context, params, heavy.octaves),
        at: onGrid(context.playAt, context, this.audio.transport.quantize_beats),
        gain: params.gain,
        fadeInS: this.fadeIn(params.fade_in_s),
        maxS: params.max_s * heavy.length,
        fadeOutS: params.fade_out_s,
        bendCents: lean * params.bend_cents,
      },
      output,
    );
  }
}

/** Barely audible shimmer for something at 40,000 feet (§6.4). */
class HighOverflightVoice extends AircraftVoice {
  readonly name = 'overflight_high';

  constructor(
    audio: AudioConfig,
    private readonly kit: SampleKit,
  ) {
    super(audio);
  }

  handles(event: PublicEvent): boolean {
    return event.type === 'overflight_high';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.overflight_high;
    return strike(
      {
        kit: this.kit,
        midi: this.noteFor(event, context, params, 0),
        at: onGrid(context.playAt, context, this.audio.transport.quantize_beats),
        gain: params.gain,
        fadeInS: this.fadeIn(params.fade_in_s),
        maxS: params.max_s,
        fadeOutS: params.fade_out_s,
      },
      output,
    );
  }
}

/**
 * A flutter rather than a note: the rotor is the identifying feature (§6.4).
 *
 * The one aircraft voice still synthesised. A struck sample cannot flutter, and §6.4
 * names the tremolo rate as what identifies this voice — so a sample would cost
 * exactly the thing the voice exists for.
 */
class HelicopterVoice extends AircraftVoice {
  readonly name = 'helicopter';

  handles(event: PublicEvent): boolean {
    return event.type === 'helicopter';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.helicopter;
    const midi = scaleDegreeToMidi(context.rootMidi, context.scale, degreeFor(event, context));
    const start = onGrid(context.playAt, context, this.audio.transport.quantize_beats);
    const total = this.fadeIn(params.attack_s) + params.hold_s + params.release_s;

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
      attack: this.fadeIn(params.attack_s),
      decay: 0.2,
      sustain: 1,
      release: params.release_s,
    });
    const level = new Tone.Gain(params.gain);
    oscillator.connect(tremolo);
    tremolo.connect(envelope);
    envelope.connect(level);
    level.connect(output.destination as Tone.InputNode);
    output.own(oscillator);
    output.own(tremolo);
    output.own(envelope);
    output.own(level);

    tremolo.start(start);
    oscillator.start(start);
    // An `AmplitudeEnvelope` releases exponentially and never reaches zero, so
    // stopping the oscillator when the release nominally ends cuts a waveform
    // mid-cycle — a step discontinuity, which is a click. The first dense render's
    // spectrogram showed them plainly: vertical streaks up to 12 kHz at event times,
    // in a piece whose loudest intended component dies by 2 kHz. Four release
    // constants puts the envelope ~35 dB down before the oscillator stops.
    const stopTail = params.release_s * 4;
    oscillator.stop(start + total + stopTail);
    envelope.triggerAttack(start);
    envelope.triggerRelease(start + this.fadeIn(params.attack_s) + params.hold_s);
    return total + stopTail;
  }
}

/**
 * Ring crossings: one plucked note as an aircraft comes in from the horizon.
 *
 * Deliberately the plainest voice in the set. There are three or four of these for
 * every named event, so anything with a shape of its own would become the piece
 * within a minute — §6.5's "demote the rest to texture", built in rather than applied
 * by the governor afterwards.
 */
class SkyVoice extends AircraftVoice {
  readonly name = 'sky';

  constructor(
    audio: AudioConfig,
    private readonly kit: SampleKit,
  ) {
    super(audio);
  }

  handles(event: PublicEvent): boolean {
    return event.type === 'sky';
  }

  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number {
    const params = this.audio.voices.sky;
    const heavy = this.heavy(event);
    return strike(
      {
        kit: this.kit,
        midi: this.noteFor(event, context, params, heavy.octaves),
        at:
          onGrid(context.playAt, context, this.audio.transport.quantize_beats) +
          drag(context.random, 25),
        gain: params.gain,
        fadeInS: this.fadeIn(params.fade_in_s),
        maxS: params.max_s * heavy.length,
        fadeOutS: params.fade_out_s,
      },
      output,
    );
  }
}

/**
 * Every aircraft voice, in the order the engine should try them.
 *
 * A voice whose kit is missing is left out rather than silently falling back to an
 * oscillator: a fallback would mean the piece quietly sounded like the version that
 * lost two listening rounds, and the engine already copes with an event no voice
 * claims. `kits` is empty only before the samples have loaded.
 *
 * Which means a missing kit costs a whole voice in silence, and that happened: a
 * `manifest.json` written by a partial rebuild listed one kit of five, so four of
 * these voices were never constructed — through two commits and a listening round,
 * with every sample sitting in the repo. `requiredInstruments` exists so the page
 * can say so out loud; `tools/test-sample-pitch.py` is what stops it recurring.
 */
export function requiredInstruments(audio: AudioConfig): string[] {
  return [
    audio.voices.ewr_departure.instrument,
    audio.voices.ewr_arrival.instrument,
    audio.voices.overflight_city.instrument,
    audio.voices.overflight_high.instrument,
    audio.voices.sky.instrument,
  ];
}

export function aircraftVoices(audio: AudioConfig, kits: Map<string, SampleKit>): Voice[] {
  const voices: Voice[] = [];
  const kitFor = (params: StruckParams): SampleKit | undefined => kits.get(params.instrument);

  const departure = kitFor(audio.voices.ewr_departure);
  if (departure !== undefined) {
    voices.push(
      new FigureVoice(
        'ewr_departure',
        audio,
        'ewr_departure',
        audio.voices.ewr_departure,
        1,
        departure,
      ),
    );
  }
  const arrival = kitFor(audio.voices.ewr_arrival);
  if (arrival !== undefined) {
    voices.push(
      new FigureVoice('ewr_arrival', audio, 'ewr_arrival', audio.voices.ewr_arrival, -1, arrival),
    );
  }
  const overflight = kitFor(audio.voices.overflight_city);
  if (overflight !== undefined) voices.push(new OverflightVoice(audio, overflight));
  const high = kitFor(audio.voices.overflight_high);
  if (high !== undefined) voices.push(new HighOverflightVoice(audio, high));

  voices.push(new HelicopterVoice(audio));

  const sky = kitFor(audio.voices.sky);
  if (sky !== undefined) voices.push(new SkyVoice(audio, sky));

  return voices;
}
