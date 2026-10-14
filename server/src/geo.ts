/**
 * Spherical geometry: distance and bearing on the Earth's surface.
 *
 * Used for every event we emit (SPEC §4 `rel`), so it is the most load-bearing
 * arithmetic in the project. Bearing drives stereo pan and distance drives gain,
 * filter cutoff and reverb send (SPEC §6.4) — a sign error here would mirror the
 * entire city in the stereo field without anything failing.
 *
 * A sphere is accurate enough. Over our 25 nm radius the error against the WGS-84
 * ellipsoid is a few tens of metres, far below what is audible as a pan change.
 * Note the error is not uniform: at Newark's latitude the mean radius sits between
 * the meridional and prime-vertical radii, so the sphere slightly overestimates
 * north-south distances and underestimates east-west ones.
 *
 * PRECONDITION: all inputs must be finite. These functions propagate NaN rather
 * than throwing, and `JSON.stringify(NaN)` is `null`, so a non-finite coordinate
 * would reach the wire as `rel: {bearing_deg: null}`. Per CLAUDE.md, validation
 * belongs at the collector boundary — guard there, not here.
 */

/** IUGG mean Earth radius, km. */
const EARTH_RADIUS_KM = 6371.0088;

/** International nautical mile. SPEC uses nm for API radii, km for city distances. */
export const KM_PER_NAUTICAL_MILE = 1.852;

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * Great-circle distance in kilometres (haversine).
 *
 * Uses the atan2 form rather than asin for numerical stability at antipodal
 * points, and clamps the radicand because floating-point error can push it
 * marginally above 1 for coincident points.
 */
export function distanceKm(from: LatLon, to: LatLon): number {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const deltaPhi = phi2 - phi1;
  const deltaLambda = toRadians(to.lon - from.lon);

  const a =
    Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, a));

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/**
 * Initial bearing from `from` to `to`, in degrees clockwise from true north,
 * normalised to [0, 360).
 *
 * The direction you would look from `from` to see `to` — so for an event this is
 * the bearing from NJIT to the aircraft, which is what SPEC §6.4 pans by.
 * Cross-checked against SPEC §4's own example: an event near EWR gives ~171°,
 * and the spec's sample event carries `bearing_deg: 172`.
 *
 * Note this is the *initial* bearing of the great-circle path; it changes along a
 * long route. Irrelevant at our scale, and the right value regardless, since what
 * we want is the direction to look right now.
 */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const deltaLambda = toRadians(to.lon - from.lon);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** True when `point` lies within `radiusKm` of `centre`. Inclusive at the boundary. */
export function isWithinKm(centre: LatLon, point: LatLon, radiusKm: number): boolean {
  return distanceKm(centre, point) <= radiusKm;
}

export function nauticalMilesToKm(nm: number): number {
  return nm * KM_PER_NAUTICAL_MILE;
}

export function kmToNauticalMiles(km: number): number {
  return km / KM_PER_NAUTICAL_MILE;
}
