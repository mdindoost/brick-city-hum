/**
 * adsb.lol and adsb.fi — the primary and first-fallback aircraft sources.
 *
 * One parser serves both. Verified 2026-10-14 (docs/verification.md): their
 * per-aircraft fields are identical, but the envelope differs — adsb.lol returns the
 * list under `ac`, adsb.fi under `aircraft`. That one difference is the whole reason
 * this is a shared adapter rather than two files.
 *
 * Both report feet and ft/min, which are our canonical units, so nothing is converted
 * here. OpenSky would need `units.ts` (metres, m/s) — see docs/verification.md.
 */

import { z } from 'zod';
import { classifyCallsign, type Observation, type IdentityKind } from '../observation.js';

/**
 * One aircraft as the API actually returns it.
 *
 * Field presence is the hazard here, and it is not hypothetical. In a real 114-aircraft
 * response: `alt_baro` was an integer on 46 and the **string `"ground"`** on 68;
 * `alt_geom` was present on 51; `baro_rate` on 41; `geom_rate` on 30; `flight` on 108.
 * So almost everything is optional, and the two vertical-rate fields are usually not
 * both present — a parser that required either would drop most of the traffic.
 */
const aircraftSchema = z.object({
  hex: z.string().min(1),
  /**
   * Barometric altitude in feet — OR the literal string `"ground"`.
   *
   * This is the single most dangerous field in the project. It is an integer in an
   * otherwise-numeric field, so `Number(alt_baro)` yields `NaN` for a parked
   * aircraft, and a comparison against an altitude gate then silently reads as
   * false. SPEC §3.2's departure rule depends on knowing an aircraft *was* on the
   * ground, so getting this wrong produces phantom departures from aircraft that
   * never moved.
   */
  alt_baro: z.union([z.number(), z.literal('ground')]).optional(),
  alt_geom: z.number().optional(),
  baro_rate: z.number().optional(),
  geom_rate: z.number().optional(),
  category: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  gs: z.number().optional(),
  /**
   * Seconds since this aircraft's position was last updated. Live data shows up to
   * ~50 s for parked aircraft and under 1 s airborne, so a poll's aircraft were not
   * all seen at the same instant — which is why `t` is backdated by this rather than
   * being the receive time (SPEC §4 asks for a "best estimate").
   */
  seen_pos: z.number().optional(),
  /** Callsign, space-padded by the API (`"UAL1810 "`). Must be trimmed. */
  flight: z.string().optional(),
  /** Aircraft type code, e.g. `B738`. Permitted for every aircraft (SPEC §3.2). */
  t: z.string().optional(),
  /**
   * Registration (tail number). Parsed only so it is explicitly and visibly
   * discarded — see `toObservation`. It must never reach an Observation.
   */
  r: z.string().optional(),
  /** Operator name, present on adsb.fi. Discarded for the same reason as `r`. */
  ownOp: z.string().optional(),
});

export type RawAircraft = z.infer<typeof aircraftSchema>;

/** Accepts either envelope: adsb.lol's `ac` or adsb.fi's `aircraft`. */
const responseSchema = z
  .object({
    ac: z.array(z.unknown()).optional(),
    aircraft: z.array(z.unknown()).optional(),
    now: z.number().optional(),
  })
  .passthrough();

/**
 * Fields removed from the raw copy before it can be recorded.
 *
 * `flight` is here for a reason that cost a real bug: **for a private aircraft the
 * callsign IS the registration.** Stripping `r` while copying `flight` verbatim
 * wrote the identical string one field over, straight into the append-only
 * recordings — the exact leak §3.7 exists to prevent. The leak also survived a
 * verification grep, because the API space-pads the value (`"N6091F  "`) and the
 * regex expected a closing quote right after the characters.
 *
 * `flight` is not simply dropped: it is replaced by the classifier's verdict (see
 * `stripIdentifyingFields`), so an airline flight number is still recorded — it is
 * needed for tuning and permitted by §3.2 — while a tail number never is.
 */
export const IDENTIFYING_FIELDS = ['r', 'ownOp', 'reg', 'registration', 'owner', 'flight'] as const;

export interface ParseResult {
  readonly observations: Observation[];
  /**
   * The raw aircraft entries with identifying fields removed, for the recorder.
   *
   * SPEC §3.5 wants raw responses recorded so detection thresholds can be re-tuned
   * without waiting another 48 hours; SPEC §3.7 forbids identity reaching the
   * append-only recordings. Both hold: "raw" here means every field *except*
   * identity. Nothing needed for tuning (altitude, rates, category, position) is
   * lost, because none of it is identifying.
   */
  readonly rawForRecording: Record<string, unknown>[];
  /** Entries we could not parse at all, counted for health rather than thrown. */
  readonly skipped: number;
  /** How many entries the response contained, parseable or not. */
  readonly total: number;
  /** The source's own timestamp from the envelope, kept so staleness can be
   * reconstructed during tuning. An earlier version discarded it. */
  readonly sourceNow: number | null;
}

/**
 * Strip identity from an arbitrary raw entry, without assuming it parsed.
 *
 * Every field in `IDENTIFYING_FIELDS` is removed, then `flight` is put back **only**
 * when the classifier says it is an airline flight number — trimmed, so no
 * space-padded tail number can slip through a later text search.
 */
export function stripIdentifyingFields(entry: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!(IDENTIFYING_FIELDS as readonly string[]).includes(key)) {
      copy[key] = value;
    }
  }
  const raw = entry['flight'];
  const { identity, callsign } = classifyCallsign(typeof raw === 'string' ? raw : null);
  if (identity === 'airline' && callsign !== null) {
    copy['flight'] = callsign;
  }
  return copy;
}

function verticalRate(aircraft: RawAircraft): number | null {
  // Prefer barometric (it is what altitude is measured in, so the two agree), fall
  // back to geometric. Only ~36% of aircraft report baro_rate and ~26% geom_rate,
  // and they are often not the same aircraft, so requiring either would lose most
  // of the traffic.
  return aircraft.baro_rate ?? aircraft.geom_rate ?? null;
}

function altitude(aircraft: RawAircraft): { altFt: number | null; onGround: boolean } {
  if (aircraft.alt_baro === 'ground') {
    return { altFt: null, onGround: true };
  }
  if (typeof aircraft.alt_baro === 'number') {
    return { altFt: aircraft.alt_baro, onGround: false };
  }
  // Neither a number nor "ground": altitude is simply unknown. Fall back to the
  // geometric altitude if present, but do not guess at ground state.
  return { altFt: aircraft.alt_geom ?? null, onGround: false };
}

/**
 * Convert one parsed aircraft into an Observation, or `null` if it is unusable.
 *
 * Unusable means no position: SPEC §4's `rel` (bearing and distance from NJIT) is
 * what the music is built from, and the geo functions propagate NaN rather than
 * throwing, so an aircraft without lat/lon must be dropped here rather than reaching
 * the wire as `bearing_deg: null`. (This is the boundary guard that `geo.ts`'s
 * documented precondition defers to.)
 */
export function toObservation(
  aircraft: RawAircraft,
  receivedAt: number,
  source: string,
): Observation | null {
  if (
    aircraft.lat === undefined ||
    aircraft.lon === undefined ||
    !Number.isFinite(aircraft.lat) ||
    !Number.isFinite(aircraft.lon)
  ) {
    return null;
  }

  const { altFt, onGround } = altitude(aircraft);
  const { identity, callsign } = classifyCallsign(aircraft.flight);
  const positionAgeS = aircraft.seen_pos ?? null;
  // Backdate to when the position was actually true. Clamped at 0 so a nonsense
  // negative age from upstream cannot produce a timestamp in the future.
  const observedAt =
    positionAgeS === null || !Number.isFinite(positionAgeS) || positionAgeS < 0
      ? receivedAt
      : receivedAt - Math.round(positionAgeS * 1000);

  // Note what is NOT carried over: `r` (registration) and `ownOp` (operator). For a
  // private aircraft the callsign is usually the tail number too, which is why
  // `classifyCallsign` nulls it rather than passing it through.
  return {
    icao: aircraft.hex.trim().toLowerCase(),
    t: observedAt,
    lat: aircraft.lat,
    lon: aircraft.lon,
    altFt,
    onGround,
    verticalRateFpm: verticalRate(aircraft),
    groundSpeedKt: aircraft.gs ?? null,
    category: aircraft.category ?? null,
    identity,
    callsign,
    typeCode: aircraft.t ?? null,
    source,
    positionAgeS,
  };
}

/**
 * Parse a whole response from adsb.lol or adsb.fi.
 *
 * Never throws on a single bad aircraft entry: one malformed record in a
 * 114-aircraft response must not cost us the whole poll. Unparseable entries are
 * counted and reported to health instead.
 */
export function parseAdsbResponse(body: unknown, receivedAt: number, source: string): ParseResult {
  const envelope = responseSchema.safeParse(body);
  if (!envelope.success) {
    throw new Error(`${source}: response is not a recognised ADS-B envelope`);
  }

  const list = envelope.data.ac ?? envelope.data.aircraft;
  if (list === undefined) {
    throw new Error(`${source}: response has neither an "ac" nor an "aircraft" array`);
  }

  const observations: Observation[] = [];
  const rawForRecording: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const entry of list) {
    // Keep the raw copy FIRST, whether or not the entry parses. If the upstream
    // schema drifts, these are the only record of what actually changed — excluding
    // unparseable entries would leave the drift undiagnosable after the fact.
    if (typeof entry === 'object' && entry !== null) {
      rawForRecording.push(stripIdentifyingFields(entry as Record<string, unknown>));
    }
    const parsed = aircraftSchema.safeParse(entry);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const observation = toObservation(parsed.data, receivedAt, source);
    if (observation === null) {
      skipped += 1;
      continue;
    }
    observations.push(observation);
  }

  // A response full of aircraft from which we understood none is schema drift, not a
  // quiet sky. Reported as a failure so backoff and failover engage: otherwise the
  // poll records `ok` with zero observations, /healthz stays green, and the 48-hour
  // recording (§13) quietly collects nothing at all.
  if (list.length > 0 && observations.length === 0) {
    throw new Error(
      `${source}: ${String(list.length)} aircraft returned but none could be parsed — ` +
        `the upstream schema has probably changed`,
    );
  }

  return {
    observations,
    rawForRecording,
    skipped,
    total: list.length,
    sourceNow: envelope.data.now ?? null,
  };
}

export type { IdentityKind };
