/**
 * The event→voice interface. P0-7a.
 *
 * This is the one piece of Phase 0's audio work that is **not** disposable: every
 * Phase 1 voice implements it, so it is worth getting right now, while the only
 * implementation is a deliberately crude probe and interface mistakes are cheap.
 *
 * The shape of the problem: an event arrives with a bearing, a distance, an altitude
 * and a salience (SPEC §4). A voice turns that into sound, scheduled at an exact
 * time on a shared transport so every listener hears it at the same moment (§9.4).
 * The voice decides timbre and gesture; the engine owns spatialisation, the master
 * chain and the voice budget, because those are mix-wide invariants no single voice
 * may be trusted with (§6.8).
 */

/**
 * The client-facing event. Re-exported rather than redefined: `shared/protocol.ts`
 * is the one description of what crosses the wire, and a second copy here is a
 * second thing to forget to update — this file's copy had already fallen behind by
 * two fields.
 */
export type { PublicEvent } from '../../../shared/protocol.js';
import type { PublicEvent } from '../../../shared/protocol.js';

/**
 * Everything a voice is told, beyond the event itself.
 *
 * `playAt` is in Tone.js context seconds, already converted from the server's
 * `play_at` (§9.4). A voice must schedule against it and must never read the local
 * clock: that is what keeps listeners in sync and what makes an offline render
 * reproducible.
 */
export interface VoiceContext {
  readonly playAt: number;
  /** Seeded PRNG in [0, 1). The ONLY source of randomness a voice may use (§5). */
  readonly random: () => number;
  /** Scale degrees, in semitones from the current drone centre (§6.2). */
  readonly scale: readonly number[];
  /** MIDI note number of the current harmonic centre. */
  readonly rootMidi: number;
  /** Seconds per beat on the shared transport, for gesture lengths (§6.3). */
  readonly secondsPerBeat: number;
}

/**
 * The node a voice connects its output to.
 *
 * Deliberately not the destination: the engine inserts spatialisation, the distance
 * filter and the master chain behind this. A voice that reached the destination
 * directly could bypass the §6.8 limiter and the voice cap, which is exactly the
 * class of mistake the probe exists to make impossible later.
 */
export interface VoiceOutput {
  /** Where audio goes. Typed loosely so the lab can substitute an offline node. */
  readonly destination: unknown;
  /**
   * Hand the engine a node to dispose when this gesture is released.
   *
   * It exists because the alternative leaked. A voice is registered once and
   * `schedule`d thousands of times, so a voice that kept its own list of the nodes it
   * built — which is what every voice did until this was added — held every synth it
   * had ever made until the engine shut down. At the measured ~100 events a minute
   * that is six thousand live audio nodes an hour, in a page meant to be left open
   * all day. The engine already disposes each event's spatialisation chain twelve
   * seconds after the gesture ends; this puts the voice's own nodes in the same hands.
   */
  own(node: { dispose: () => void }): void;
}

export interface Voice {
  /** Stable name, for voice-cap accounting and lab reports. */
  readonly name: string;
  /** Event types this voice claims. */
  handles(event: PublicEvent): boolean;
  /**
   * Schedule the sound. Must return synchronously having only *scheduled* audio —
   * never having played it — so `Tone.Offline` can render faster than real time.
   *
   * Returns how long the gesture lasts, in seconds, so the engine can account for
   * the voice budget (§6.8: 24 desktop / 12 mobile) without asking the voice again.
   */
  schedule(event: PublicEvent, context: VoiceContext, output: VoiceOutput): number;
  /** Release any nodes. Called when the voice is stolen or the engine stops. */
  dispose(): void;
}

/** Quantise a scale-degree index to a MIDI note. Shared so voices agree on tuning. */
export function scaleDegreeToMidi(
  rootMidi: number,
  scale: readonly number[],
  degree: number,
): number {
  if (scale.length === 0) return rootMidi;
  const octave = Math.floor(degree / scale.length);
  const index = ((degree % scale.length) + scale.length) % scale.length;
  return rootMidi + (scale[index] ?? 0) + octave * 12;
}

/**
 * Map a bearing to a stereo pan position in [-1, 1].
 *
 * SPEC §6.4: bearing from the origin drives pan, so a plane to the south is heard
 * from the south. 0° (north) and 180° (south) both sit centre; east is +1, west −1.
 *
 * **Rate-limited by the caller, not here** — see `panSlewLimit`.
 */
export function bearingToPan(bearingDeg: number): number {
  return Math.sin((bearingDeg * Math.PI) / 180);
}

/**
 * The maximum pan change per second a moving voice may make.
 *
 * This exists because of a specific, measured hazard. §3.2's `overflight_city`
 * circle is 3 km, so an aircraft passing nearly over the origin swings through ~180°
 * of bearing between two 10-second polls — e.g. 2° then 182°. §6.4 wants the pan to
 * follow the aircraft, but applied directly that is an audible snap from one ear to
 * the other at the exact moment a listener is most likely to be paying attention.
 */
export const PAN_SLEW_PER_SECOND = 0.35;

export function panSlewLimit(current: number, target: number, elapsedSeconds: number): number {
  const maxChange = PAN_SLEW_PER_SECOND * elapsedSeconds;
  const delta = target - current;
  if (Math.abs(delta) <= maxChange) return target;
  return current + Math.sign(delta) * maxChange;
}

/**
 * Distance → gain, cutoff and reverb send (SPEC §6.4: farther is quieter, darker, wetter).
 *
 * Exported as one function so the three move together: a voice that attenuated gain
 * but not cutoff would sound near and quiet rather than far away.
 */
export function distanceToMix(distanceKm: number): {
  gain: number;
  cutoffHz: number;
  reverbSend: number;
} {
  const normalised = Math.min(1, Math.max(0, distanceKm / 46.3)); // 25 nm poll radius
  return {
    gain: 1 - 0.75 * normalised,
    // §6.8 tames harshness: nothing sustained above ~6 kHz even at zero distance.
    cutoffHz: 6000 - 4600 * normalised,
    reverbSend: 0.1 + 0.5 * normalised,
  };
}

/** Altitude → register offset in semitones (SPEC §6.4: lower altitude, lower voice). */
export function altitudeToSemitones(altFt: number | null): number {
  if (altFt === null) return 0;
  const normalised = Math.min(1, Math.max(0, altFt / 35000));
  return Math.round(normalised * 24);
}

/**
 * Fold a note into an instrument's register, by octaves (SPEC §6.4, §6.9).
 *
 * Altitude maps to two octaves of pitch, and no sample kit spans that from its own
 * recorded notes — the tubular bells are nine files across sixteen semitones. Beyond
 * its range the nearest sample has to be bent so far that it stops sounding like the
 * instrument: a chime pitched down a fifth is a slow, dull, obviously-stretched
 * chime. So each voice declares in `score.yaml` the register it lives in.
 *
 * **By octaves rather than by clamping**, which is the whole point. Clamping was the
 * first version and it folds every note below the register onto one note — the
 * bottom of the altitude range becomes a single repeated pitch, which is exactly the
 * monotony the piece is being rewritten to escape. An octave keeps the scale degree,
 * so the note is still in the palette (§6.2's no wrong notes, ever) and the shape of
 * the altitude mapping survives; only its absolute octave is the instrument's choice
 * rather than the aircraft's.
 *
 * A register narrower than an octave has nowhere to fold to, so it clamps instead.
 */
export function foldToRegister(midi: number, register: readonly number[]): number {
  const low = register[0];
  const high = register[1];
  if (low === undefined || high === undefined || high < low) return midi;
  if (high - low < 12) return Math.min(high, Math.max(low, midi));
  let folded = midi;
  while (folded < low) folded += 12;
  while (folded > high) folded -= 12;
  return folded;
}

/**
 * Which recorded note a sampler should play for `midi` (SPEC §6.9).
 *
 * The nearest one, and on a tie the lower — a sample bent up loses length and gains
 * brightness, which on a struck sound is the less wrong of the two directions
 * because it preserves the attack's sharpness. `available` need not be sorted.
 *
 * Returns `midi` itself when there is nothing to choose from, so a caller with an
 * empty kit plays at the right pitch rather than at zero.
 */
export function nearestNote(available: readonly number[], midi: number): number {
  let best: number | undefined;
  for (const candidate of available) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const closer = Math.abs(candidate - midi) < Math.abs(best - midi);
    const tiedAndLower = Math.abs(candidate - midi) === Math.abs(best - midi) && candidate < best;
    if (closer || tiedAndLower) best = candidate;
  }
  return best ?? midi;
}
