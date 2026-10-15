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
 * ADS-B emitter category, e.g. `A3`. SPEC §3.2 keys two rules off this: A7 is a
 * helicopter and gets its own timbre, A5 is a heavy and gets a lower, longer voice.
 *
 * Kept as a plain string rather than an enum, because it comes from an external
 * source and an unknown value must degrade to "no category" rather than break a poll.
 *
 * **The category values themselves live in `config/sources.yaml`** under
 * `detection.helicopter.emitter_category` and `detection.heavy.emitter_category`
 * (SPEC §5: no tuning value in code). An earlier version declared them here as well,
 * which meant editing the YAML changed nothing. The detector (P0-5) reads them from
 * config.
 */
export type EmitterCategory = string;

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

/**
 * The validated shape of an observation.
 *
 * `Observation` is derived from this schema rather than declared separately: an
 * earlier version had both, hand-mirrored, with nothing tying them together — so the
 * schema could silently drift from the type it was supposed to validate, and P0-3's
 * acceptance criterion ("ndjson lines validate against the schema") was not actually
 * being met by anything.
 */
export const observationSchema = z.object({
  /** ICAO 24-bit address, lowercase hex. Our track key. Not publicly identifying. */
  icao: z.string().min(1),
  /**
   * Best estimate of when this position was true, in epoch ms (SPEC §4).
   *
   * Not simply the receive time: adsb.lol reports `seen_pos`, the age of the position
   * fix, which runs to tens of seconds for parked aircraft. Backdating by it means a
   * stale repeat is recognisable as the same observation instead of looking like a
   * fresh one at a new time.
   */
  t: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Barometric altitude in feet, or `null` when on the ground or unknown. */
  altFt: z.number().nullable(),
  onGround: z.boolean(),
  /** Vertical rate in ft/min, positive climbing. `null` when not reported. */
  verticalRateFpm: z.number().nullable(),
  /** Ground speed in knots. `null` when not reported. */
  groundSpeedKt: z.number().nullable(),
  /**
   * Ground track in degrees, or null. The direction the aircraft is actually going,
   * which is not the bearing from the listener to it — drawing a silhouette without
   * this would point every aircraft at a direction it is not travelling.
   */
  trackDeg: z.number().nullable().default(null),
  category: z.string().nullable(),
  identity: z.enum(['airline', 'private']),
  /**
   * Operator flight number, e.g. `UAL1810`. Always `null` when
   * `identity === 'private'` — see SPEC §3.2 and §3.7.
   */
  callsign: z.string().nullable(),
  /** Aircraft type code, e.g. `B738`. Permitted for every aircraft. */
  typeCode: z.string().nullable(),
  source: z.string().min(1),
  /** Age of the position fix in seconds, as reported. Kept for tuning. */
  positionAgeS: z.number().nullable(),
});

export type Observation = z.infer<typeof observationSchema>;

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
