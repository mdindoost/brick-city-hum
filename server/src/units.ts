/**
 * Physical unit conversions, named explicitly.
 *
 * (Geometric conversions — nautical miles to kilometres — live in `geo.ts` with the
 * distance functions that use them. This file is altitude, rate and speed.)
 *
 * This file exists because of a specific, verified hazard. Our sources disagree:
 * adsb.lol and adsb.fi report altitude in **feet** and vertical rate in **ft/min**,
 * while OpenSky reports both in **metres** and **m/s** (docs/verification.md).
 * SPEC §3.2's thresholds are written in feet and ft/min.
 *
 * A unit mix-up here would not crash and would not fail a test that only checks
 * "a departure was detected" — it would simply make the city sound wrong, which is
 * far harder to notice and far harder to trace. So: every collector converts to the
 * canonical units at its own boundary, using these functions, and nothing
 * downstream converts anything.
 *
 * Canonical units used everywhere past the normalizer:
 *   distance  km          altitude       feet
 *   bearing   degrees     vertical rate  ft/min
 *   time      epoch ms    ground speed   knots
 *
 * Ground speed is canonically knots because that is what aviation and adsb.lol both
 * use; OpenSky's `velocity` is m/s and must be converted (docs/verification.md).
 */

export const FEET_PER_METRE = 3.280839895013123;
export const SECONDS_PER_MINUTE = 60;
/** One knot is one nautical mile (1852 m exactly) per hour. */
export const METRES_PER_SECOND_PER_KNOT = 1852 / 3600;

export function metresToFeet(metres: number): number {
  return metres * FEET_PER_METRE;
}

export function feetToMetres(feet: number): number {
  return feet / FEET_PER_METRE;
}

/** Metres per second → feet per minute. OpenSky's `vertical_rate` → our canonical. */
export function mpsToFeetPerMinute(mps: number): number {
  return mps * FEET_PER_METRE * SECONDS_PER_MINUTE;
}

export function feetPerMinuteToMps(fpm: number): number {
  return fpm / (FEET_PER_METRE * SECONDS_PER_MINUTE);
}

/** Metres per second → knots. OpenSky's `velocity` → our canonical ground speed. */
export function mpsToKnots(mps: number): number {
  return mps / METRES_PER_SECOND_PER_KNOT;
}

export function knotsToMps(knots: number): number {
  return knots * METRES_PER_SECOND_PER_KNOT;
}
