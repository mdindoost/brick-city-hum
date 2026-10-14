/**
 * A single aircraft seen once: the normalized, privacy-filtered unit the collectors
 * produce and the detector consumes.
 *
 * Not the same thing as a SPEC §4 `event`. An observation is "this aircraft was here,
 * at this altitude, climbing at this rate, at this moment". An event is a musical
 * fact derived from several observations ("a departure happened"). The collector makes
 * observations; the detector (P0-5) makes events.
 */

import { z } from 'zod';

/**
 * ADS-B emitter category. SPEC §3.2 keys two rules off this: A7 is a helicopter and
 * gets its own timbre, A5 is a heavy and gets a lower, longer voice.
 *
 * Kept as a plain string rather than an enum: it comes from an external source and
 * an unknown value must degrade to "no category" rather than break a poll.
 */
export type EmitterCategory = string;

export const HELICOPTER_CATEGORY = 'A7';
export const HEAVY_CATEGORY = 'A5';

/**
 * How we may identify an aircraft, per SPEC §3.2's privacy rule:
 *
 * > show airline flights by flight number and route. For non-airline aircraft
 * > (private, general aviation), show only the aircraft type (e.g. "a small private
 * > jet"), never the tail number or owner.
 *
 * `airline` — the callsign is an operator flight number (UAL1810) and may be shown.
 * `private` — the callsign is, or may be, a tail number. It is **discarded**, not
 *   stored and not recorded, and only the aircraft type survives.
 */
export type IdentityKind = 'airline' | 'private';

export interface Observation {
  /** ICAO 24-bit address, lowercase hex. Our track key. Not publicly identifying. */
  readonly icao: string;
  /** Server epoch ms when this observation was received. */
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  /** Barometric altitude in feet, or `null` when the aircraft is on the ground. */
  readonly altFt: number | null;
  /** True when the source reported the aircraft as on the ground. */
  readonly onGround: boolean;
  /** Vertical rate in ft/min, positive climbing. `null` when not reported. */
  readonly verticalRateFpm: number | null;
  /** Ground speed in knots. `null` when not reported. */
  readonly groundSpeedKt: number | null;
  readonly category: EmitterCategory | null;
  readonly identity: IdentityKind;
  /**
   * Operator flight number, e.g. `UAL1810`. Always `null` when
   * `identity === 'private'` — see SPEC §3.2 and §3.7.
   */
  readonly callsign: string | null;
  /** Aircraft type code, e.g. `B738`. Permitted for every aircraft. */
  readonly typeCode: string | null;
  readonly source: string;
}

/**
 * An ICAO airline callsign: a three-letter operator code followed by a flight
 * number, e.g. `UAL1810`, `DAL45`, `AAL9`. A trailing letter is allowed because some
 * operators use suffixes (`BAW117A`).
 */
const AIRLINE_CALLSIGN = /^[A-Z]{3}\d{1,4}[A-Z]?$/;

/**
 * Classify a callsign, and this is the privacy-critical decision in the collector.
 *
 * The non-obvious hazard: **for a private aircraft the callsign usually IS the tail
 * number.** A real observation from the verification probe carried
 * `registration: "N144CD"` on a Robinson R44 whose callsign was the same string. So
 * simply dropping the `r`/`registration` field is not enough — passing `flight`
 * through verbatim would publish the tail number of every private aircraft over
 * Newark, which SPEC §3.2 forbids, and bake it into append-only recordings.
 *
 * This is a heuristic, and it fails safe: anything that is not clearly an airline
 * flight number is treated as private, so the cost of a miss is a slightly duller
 * caption ("a small private jet" instead of a flight number), never a privacy breach.
 * Known imperfection: a few operators file callsigns outside the ICAO pattern and
 * will be classified private.
 */
export function classifyCallsign(raw: string | null | undefined): {
  identity: IdentityKind;
  callsign: string | null;
} {
  const trimmed = raw?.trim().toUpperCase() ?? '';
  if (trimmed.length > 0 && AIRLINE_CALLSIGN.test(trimmed)) {
    return { identity: 'airline', callsign: trimmed };
  }
  return { identity: 'private', callsign: null };
}

export const observationSchema = z.object({
  icao: z.string().min(1),
  t: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altFt: z.number().nullable(),
  onGround: z.boolean(),
  verticalRateFpm: z.number().nullable(),
  groundSpeedKt: z.number().nullable(),
  category: z.string().nullable(),
  identity: z.enum(['airline', 'private']),
  callsign: z.string().nullable(),
  typeCode: z.string().nullable(),
  source: z.string().min(1),
});

export function isHelicopter(observation: Observation): boolean {
  return observation.category === HELICOPTER_CATEGORY;
}

export function isHeavy(observation: Observation): boolean {
  return observation.category === HEAVY_CATEGORY;
}
