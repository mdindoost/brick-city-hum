/**
 * The CC0 sample kits, and the one function that strikes a note. SPEC §6.9, §6.4.
 *
 * **Why this file exists at all.** Two listening rounds were lost to the same
 * verdict: background noise, no musical feeling — "as if someone was really playing
 * a note" about the one piece that worked. That piece was Listen to Wikipedia, and
 * the reason it sounds played is that it plays recorded samples. A sine with an
 * envelope has no strike in it; the attack transient of a struck bar or a plucked
 * string is a broadband event that no two-oscillator voice reproduces, and it is
 * what the ear reads as a person and an instrument rather than a notification.
 *
 * So the aircraft voices play samples. The kits are built by
 * `tools/fetch-samples.py` from VCSL, are CC0, and their provenance is in
 * `client/public/samples/LICENSE.md` down to which dynamic layer each file came from.
 *
 * **One `ToneBufferSource` per note, not one `Tone.Sampler` per voice.** A Sampler is
 * a single output node, and the engine gives every event its own spatialisation
 * chain (§6.4) — a shared Sampler cannot reach a per-event panner. A buffer source
 * can, costs almost nothing to build, and in an online context Tone disposes it
 * itself when it ends.
 *
 * **Nothing here reads a clock or chooses a pitch.** Pitch comes from the voice,
 * timing from `context.playAt`, level from config. This file only knows how to turn
 * "this note, this long, this loud" into sound.
 */

import * as Tone from 'tone';
import { nearestNote, type VoiceOutput } from './types.js';

/** What `samples/manifest.json` holds: kit name → the MIDI notes it has files for. */
export type SampleManifest = Readonly<Record<string, readonly number[]>>;

/** How the bytes are obtained. The browser fetches; the lab is handed them. */
export type SampleLoader = (url: string) => Promise<ArrayBuffer>;

interface KitNote {
  readonly midi: number;
  readonly buffer: Tone.ToneAudioBuffer;
}

/**
 * One instrument's samples, and the pitch arithmetic for playing between them.
 *
 * A kit never covers the whole range a voice can ask for — the chimes are nine notes
 * across sixteen semitones — so every note is the nearest sample, bent. Which is how
 * every sampled instrument has always worked; what matters is that the bend stays
 * small enough that the instrument still sounds like itself, and that is what each
 * voice's `register` in `score.yaml` is for.
 */
export class SampleKit {
  /** Ascending by pitch, so `pick` can stop early. */
  private readonly notes: readonly KitNote[];

  constructor(
    readonly name: string,
    notes: readonly KitNote[],
  ) {
    this.notes = [...notes].sort((a, b) => a.midi - b.midi);
    if (this.notes.length === 0) throw new Error(`sample kit ${name} has no notes`);
  }

  get lowest(): number {
    return this.notes[0]?.midi ?? 0;
  }

  get highest(): number {
    return this.notes[this.notes.length - 1]?.midi ?? 0;
  }

  /** The nearest sample to `midi`, and how far in semitones it must be bent. */
  pick(midi: number): { readonly buffer: Tone.ToneAudioBuffer; readonly semitones: number } {
    const chosen = nearestNote(
      this.notes.map((note) => note.midi),
      midi,
    );
    const note = this.notes.find((candidate) => candidate.midi === chosen) ?? this.notes[0];
    if (note === undefined) throw new Error(`sample kit ${this.name} has no notes`);
    return { buffer: note.buffer, semitones: midi - note.midi };
  }
}

/** The browser's loader. Separate so the lab can supply bytes without a network. */
export const fetchSample: SampleLoader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return response.arrayBuffer();
};

/**
 * Load every kit in the manifest, in parallel.
 *
 * All of it is awaited before the engine is built. §6.9 asks for lazy loading per
 * palette, and that is the right shape when palettes use different instruments —
 * here every palette uses all five kits, so "per palette" would be all of them
 * anyway. At 3 MB the honest version is to load them up front and let the Ground,
 * which is synthesis and needs nothing, carry the first seconds.
 */
export async function loadSampleKits(options: {
  readonly baseUrl: string;
  readonly manifest: SampleManifest;
  readonly load?: SampleLoader;
}): Promise<Map<string, SampleKit>> {
  const load = options.load ?? fetchSample;
  // An empty base means the keys are already complete paths — the lab passes bytes
  // in and the names it uses have no prefix. Appending a slash to nothing made every
  // lookup absolute and the first render failed on `/harp/45.m4a`.
  const base =
    options.baseUrl === '' || options.baseUrl.endsWith('/')
      ? options.baseUrl
      : `${options.baseUrl}/`;

  const kits = await Promise.all(
    Object.entries(options.manifest).map(async ([name, midis]) => {
      const notes = await Promise.all(
        midis.map(async (midi) => {
          const data = await load(`${base}${name}/${String(midi)}.m4a`);
          const decoded = await Tone.getContext().decodeAudioData(data);
          return { midi, buffer: new Tone.ToneAudioBuffer(decoded) };
        }),
      );
      return new SampleKit(name, notes);
    }),
  );

  return new Map(kits.map((kit) => [kit.name, kit]));
}

/** Everything one struck note needs. All of it from config or from the voice. */
export interface Strike {
  readonly kit: SampleKit;
  readonly midi: number;
  /** Context seconds, already on the grid and already dragged (§6.3, §6.7.4). */
  readonly at: number;
  readonly gain: number;
  readonly fadeInS: number;
  /** Total sounding length, fade included. The sample's own length caps it. */
  readonly maxS: number;
  readonly fadeOutS: number;
  /** Pitch drift across the note, in cents. The Doppler hint of §6.4; 0 for none. */
  readonly bendCents?: number;
}

/**
 * Play one note. Returns how long it sounds, for the engine's voice budget (§6.8).
 *
 * The length arithmetic has one trap worth naming: Tone's `stop(t)` *begins* the
 * fade-out at `t`, so the note is audible until `t + fadeOut`. Asking for a duration
 * of `maxS` therefore yields a note of `maxS + fadeOut`, and a voice that reported
 * the shorter number would have the engine free its slot while it was still sounding.
 */
export function strike(note: Strike, output: VoiceOutput): number {
  const { buffer, semitones } = note.kit.pick(note.midi);
  const rate = 2 ** (semitones / 12);
  // Bending a sample up shortens it and down lengthens it, as on any sampler.
  const natural = buffer.duration / rate;
  const fadeOut = Math.min(note.fadeOutS, note.maxS / 2);
  const body = Math.max(0.02, Math.min(natural, note.maxS - fadeOut));

  const level = new Tone.Gain(note.gain);
  level.connect(output.destination as Tone.InputNode);
  const source = new Tone.ToneBufferSource({
    url: buffer,
    playbackRate: rate,
    fadeIn: note.fadeInS,
    fadeOut,
    // Exponential, because a linear fade on a ringing bar is audible as a fade and
    // an exponential one is heard as the note ending.
    curve: 'exponential',
  });
  source.connect(level);
  // The engine disposes both with the event's own chain. Tone also disposes a
  // finished buffer source by itself, but only in an online context — an offline
  // render would otherwise accumulate every node it ever built.
  output.own(level);
  output.own(source);

  source.start(note.at, 0, body);
  if (note.bendCents !== undefined && note.bendCents !== 0) {
    source.playbackRate.linearRampToValueAtTime(
      rate * 2 ** (note.bendCents / 1200),
      note.at + body,
    );
  }
  return body + fadeOut;
}
