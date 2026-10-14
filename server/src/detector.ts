/**
 * Aircraft event detection — SPEC §3.2, and the heart of Phase 1.
 *
 * Reads a per-aircraft track (oldest first, newest last) and decides whether a
 * musical event just happened. Every threshold comes from `config/sources.yaml`
 * because §3.2 says plainly they are starting values to be tuned against recorded
 * data, by people who will not be editing TypeScript.
 *
 * Two things this must never do:
 *
 * 1. **Assume a runway or a flow direction.** §3.2 is explicit. Flow at EWR reverses
 *    with the wind, often twice a day. Direction is derived from the aircraft's own
 *    altitude and vertical rate, never from which way we think traffic is going.
 * 2. **Fire the same event repeatedly.** An aircraft climbing through the departure
 *    gate is seen on several consecutive polls. Without edge detection the same
 *    departure would retrigger every 10 seconds, which is §1.4's "never chaotic"
 *    failing in the most irritating way possible.
 */

import { ulid } from 'ulid';
import type { PlacesConfig, SourcesConfig } from './config.js';
import type { CityEvent, EventType } from './events.js';
import { bearingDeg, distanceKm, nauticalMilesToKm, type LatLon } from './geo.js';
import type { Observation } from './observation.js';

/** Per-aircraft detector state, kept beside the track and expiring with it. */
interface AircraftState {
  /** Events already fired for this aircraft, so a departure fires once. */
  readonly fired: Set<EventType>;
  /** Zones the aircraft is currently inside, for entry/exit edge detection. */
  /**
   * Zones this aircraft is currently inside.
   *
   * Keyed by string rather than by event type: the distance rings all produce one
   * kind of event but need one state each, so their keys carry the radius.
   */
  readonly inside: Set<string>;
}

export interface DetectorOptions {
  readonly places: PlacesConfig;
  readonly sources: SourcesConfig;
  /** Injectable so tests get deterministic ids and the lab can reproduce a render. */
  readonly makeId?: () => string;
}

/**
 * Round a published figure to the precision an event is allowed to claim.
 *
 * The geometry is computed in full precision and only the event is rounded: a bearing
 * of 67.40309232334607° states an accuracy that neither the source nor the stereo
 * field nor the ear possesses, and config/sources.yaml says how much is honest.
 */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export class Detector {
  private readonly states = new Map<string, AircraftState>();
  private readonly makeId: () => string;
  private readonly origin: LatLon;
  private readonly ewr: LatLon;

  constructor(private readonly options: DetectorOptions) {
    this.makeId = options.makeId ?? ulid;
    this.origin = options.places.origin;
    this.ewr = options.places.places.ewr;
  }

  private stateFor(icao: string): AircraftState {
    const existing = this.states.get(icao);
    if (existing !== undefined) return existing;
    const created: AircraftState = { fired: new Set(), inside: new Set() };
    this.states.set(icao, created);
    return created;
  }

  /** Forget aircraft the track store has forgotten, so state cannot accumulate. */
  forget(icao: string): void {
    this.states.delete(icao);
  }

  retainOnly(liveIcaos: Iterable<string>): void {
    const live = new Set(liveIcaos);
    for (const icao of this.states.keys()) {
      if (!live.has(icao)) this.states.delete(icao);
    }
  }

  get trackedAircraft(): number {
    return this.states.size;
  }

  /**
   * Inspect one aircraft's track and return any events that just became true.
   *
   * `track` is oldest-first. Normally one event at most, but a single observation can
   * legitimately produce two — a helicopter crossing the city is both.
   */
  detect(track: readonly Observation[]): CityEvent[] {
    const current = track[track.length - 1];
    const previous = track[track.length - 2];
    if (current === undefined) return [];

    const state = this.stateFor(current.icao);
    const detection = this.options.sources.detection;
    const events: CityEvent[] = [];

    const distanceToOrigin = distanceKm(this.origin, current);
    const distanceToEwr = distanceKm(this.ewr, current);
    const heavy = current.category === detection.heavy.emitter_category;

    // --- EWR departure -------------------------------------------------------
    // An edge, not a state: the aircraft must CROSS the altitude gate while
    // climbing. Testing `altFt > gate` alone would fire on every poll of the climb.
    if (
      !state.fired.has('ewr_departure') &&
      distanceToEwr <= nauticalMilesToKm(detection.ewr_departure.within_nm_of_ewr) &&
      current.altFt !== null &&
      current.altFt >= detection.ewr_departure.altitude_gate_ft &&
      (current.verticalRateFpm ?? 0) >= detection.ewr_departure.min_climb_fpm &&
      previous !== undefined &&
      (previous.onGround ||
        (previous.altFt !== null && previous.altFt < detection.ewr_departure.altitude_gate_ft)) &&
      this.looksLikeItLeftTheGround(track)
    ) {
      state.fired.add('ewr_departure');
      events.push(this.buildEvent('ewr_departure', current, distanceToOrigin, heavy));
    }

    // --- EWR arrival ---------------------------------------------------------
    // Either a descent through the gate, or a transition to the ground — the second
    // catches aircraft whose descent we never saw because they appeared late.
    // A ground TRANSITION, corroborated. A single `alt_baro: "ground"` flag is not
    // evidence of a landing: low helicopters report it spuriously while airborne, and
    // in 38 minutes of live data 190 of 285 aircraft flipped at least once. One such
    // flip produced "✈ a helicopter arriving at Newark" for an aircraft climbing at
    // +896 ft/min, which is on disk in an append-only recording. So a landing must
    // also not be climbing, and must be slow enough to be on a surface.
    const landedNow =
      previous !== undefined &&
      !previous.onGround &&
      current.onGround &&
      // On the airport, not merely near it. The wider gate below is for spotting an
      // approach; a touchdown 3 nm away is at some other field.
      distanceToEwr <= nauticalMilesToKm(detection.ewr_arrival.landing_within_nm_of_ewr) &&
      (current.verticalRateFpm ?? 0) <= detection.ewr_arrival.max_landing_climb_fpm &&
      (current.groundSpeedKt ?? 0) <= detection.ewr_arrival.max_landing_speed_kt;
    if (
      !state.fired.has('ewr_arrival') &&
      distanceToEwr <= nauticalMilesToKm(detection.ewr_arrival.within_nm_of_ewr) &&
      (landedNow ||
        (current.altFt !== null &&
          current.altFt <= detection.ewr_arrival.altitude_gate_ft &&
          (current.verticalRateFpm ?? 0) <= detection.ewr_arrival.max_descent_fpm &&
          previous !== undefined &&
          previous.altFt !== null &&
          previous.altFt > detection.ewr_arrival.altitude_gate_ft))
    ) {
      state.fired.add('ewr_arrival');
      events.push(this.buildEvent('ewr_arrival', current, distanceToOrigin, heavy));
    }

    // --- Overflights ---------------------------------------------------------
    // Zone entry, with hysteresis on the way out. §6.4 holds a sustained voice while
    // the aircraft is inside, so a boundary flap would restart that voice every poll.
    const cityInside =
      distanceToOrigin <= detection.overflight_city.within_km_of_origin &&
      current.altFt !== null &&
      current.altFt < detection.overflight_city.below_ft;
    // "Left the area" is geometric distance OR being on the ground: a parked
    // aircraft is not overflying anything, and clearing on ground is what stops a
    // based helicopter from being stranded inside its zone forever.
    const leftCityZone =
      current.onGround ||
      distanceToOrigin >
        detection.overflight_city.within_km_of_origin + detection.exit_hysteresis_km;
    if (this.crossedInto('overflight_city', state, cityInside, leftCityZone, ['overflight_high'])) {
      events.push(this.buildEvent('overflight_city', current, distanceToOrigin, heavy));
    }

    const highInside =
      distanceToOrigin <= detection.overflight_high.within_km_of_origin &&
      current.altFt !== null &&
      current.altFt >= detection.overflight_high.above_ft;
    const leftHighZone =
      current.onGround ||
      distanceToOrigin >
        detection.overflight_high.within_km_of_origin + detection.exit_hysteresis_km;
    if (this.crossedInto('overflight_high', state, highInside, leftHighZone, ['overflight_city'])) {
      events.push(this.buildEvent('overflight_high', current, distanceToOrigin, heavy));
    }

    // --- Distance rings ------------------------------------------------------
    // An aircraft crossing inward through a ring, once per ring per track. The old
    // rules heard 1.4 events a minute from a sky that delivers 5.5 (measured on the
    // 14/10 recording), because everything outside 3 km was discarded. Newark is
    // 5.57 km away, so an arrival now crosses 20 km and 10 km on its way in and the
    // approach gets an approach of its own.
    for (const radiusKm of detection.rings) {
      const inside = distanceToOrigin <= radiusKm && !current.onGround;
      const band = Math.max(
        detection.exit_hysteresis_km,
        radiusKm * detection.ring_hysteresis_fraction,
      );
      const left = current.onGround || distanceToOrigin > radiusKm + band;
      // The zone key carries the radius, so six rings keep six independent states
      // while producing one kind of event.
      if (this.crossedInto(`sky:${String(radiusKm)}`, state, inside, left)) {
        events.push(this.buildEvent('sky', current, distanceToOrigin, heavy));
      }
    }

    // --- Helicopter ----------------------------------------------------------
    // Emitter category alone is not enough. A Bell 407 crossing the city reported
    // category D0 — "reserved", i.e. no category at all — so it was neither
    // detected as a helicopter nor captioned as one ("a plane over the city").
    // Category is hand-configured in the transponder and often absent; a type code
    // is not. Either signal counts, and both lists live in config.
    const isRotorcraft =
      current.category === detection.helicopter.emitter_category ||
      (current.typeCode !== null && detection.helicopter.type_codes.includes(current.typeCode));
    const heliInside =
      isRotorcraft &&
      distanceToOrigin <= detection.helicopter.within_km_of_origin &&
      current.altFt !== null &&
      current.altFt < detection.helicopter.below_ft;
    const leftHeliZone =
      current.onGround ||
      distanceToOrigin > detection.helicopter.within_km_of_origin + detection.exit_hysteresis_km;
    if (this.crossedInto('helicopter', state, heliInside, leftHeliZone)) {
      events.push(this.buildEvent('helicopter', current, distanceToOrigin, heavy));
    }

    return events;
  }

  /**
   * Zone entry with hysteresis on the way out.
   *
   * The exit test mirrors the **whole** entry predicate, not just distance. An
   * earlier version tested distance alone, so an aircraft that stopped qualifying on
   * altitude while staying within the radius was stranded "inside" forever: a
   * helicopter based near EWR — 3.3 km from the origin, inside the 5 km zone —
   * crossed once and then went permanently silent, because its state was never
   * cleared and its track never expired while it kept transmitting.
   *
   * `peers` are zones that share this pass: entering one marks them all, so a single
   * crossing cannot fire two captions. An aircraft climbing through 10,000 ft inside
   * the circle is one pass, not a city overflight plus a high overflight.
   */
  private crossedInto(
    type: string,
    state: AircraftState,
    isInside: boolean,
    hasLeftTheArea: boolean,
    peers: readonly string[] = [],
  ): boolean {
    const wasInside = state.inside.has(type);
    if (isInside) {
      if (wasInside || peers.some((peer) => state.inside.has(peer))) return false;
      state.inside.add(type);
      for (const peer of peers) state.inside.add(peer);
      return true;
    }
    if (wasInside && hasLeftTheArea) {
      state.inside.delete(type);
      for (const peer of peers) state.inside.delete(peer);
    }
    return false;
  }

  /**
   * Distinguish a real departure from a go-around.
   *
   * §3.2's rule — "the previous observation was on ground or below 500 ft" — is also
   * satisfied by a go-around: descend to 300 ft, do not land, climb away. At a busy
   * airport that is routine.
   *
   * The first attempt at this guard was wrong in both directions, which a replay of
   * real traffic showed:
   *
   *  - It accepted on `track.some(o => o.onGround)` *before* checking for a descent,
   *    so **one spurious ground flag let a go-around through** — and spurious flags
   *    are common (190 of 285 aircraft in 38 minutes).
   *  - Its altitude branch required >1,000 ft of gain between consecutive
   *    observations (>6,000 ft/min), so it was unreachable in practice — 0 of 17 real
   *    departures used it — while **rejecting a real departure** whose on-ground
   *    segment had aged out of the window. A 500–700 ft/min climber takes 2–3 minutes
   *    to reach 1,500 ft, and the window's median span is ~132 s.
   *
   * So the test is now simply: was there *sustained* evidence of being on the ground,
   * or is this climb free of any earlier descent? A go-around always has the descent.
   */
  private looksLikeItLeftTheGround(track: readonly Observation[]): boolean {
    const config = this.options.sources.detection.ewr_departure;

    // Sustained ground contact: consecutive observations, so a lone bad flag cannot
    // manufacture a departure.
    let run = 0;
    for (const observation of track) {
      run = observation.onGround ? run + 1 : 0;
      if (run >= config.min_ground_observations) return true;
    }

    // Otherwise: accept only a climb with no descent behind it anywhere in the
    // window. This is what rescues a real departure whose ground segment has aged
    // out, and what still rejects a go-around.
    return !track.some(
      (observation) => (observation.verticalRateFpm ?? 0) <= config.go_around_descent_fpm,
    );
  }

  private salienceFor(type: EventType, distanceKmNow: number, heavy: boolean): number {
    const config = this.options.sources.salience;
    const base = config[type];
    const withHeavy = base + (heavy ? config.heavy_bonus : 0);
    const proximity = 1 - distanceKmNow / config.distance_falloff_km;
    const scaled =
      withHeavy * Math.min(config.proximity_ceiling, Math.max(config.proximity_floor, proximity));
    return Math.min(1, Math.max(0, scaled));
  }

  /**
   * The airline operating this flight, or `null` — which is the usual answer.
   *
   * SPEC §3.2 as amended 2026-10-14: the **airline** may be named, the **route** may
   * not. A callsign prefix is a static mapping and is right whenever it resolves; the
   * only free route source we tested was wrong for 7 of 13 flights, and a wrong
   * destination is the one fact a listener under the flight path can check.
   *
   * Two guards, both load-bearing:
   *
   *  - `identity === 'airline'` — for a private aircraft the callsign is usually the
   *    tail number, and there is nothing here to name.
   *  - the allow-list in config — an unlisted prefix yields `null`, so fractional
   *    operators (NetJets, Flexjet), which file airline-format callsigns for private
   *    flights, are never named. See the note beside `airlines:` in sources.yaml.
   */
  private operatorFor(observation: Observation): string | null {
    if (observation.identity !== 'airline' || observation.callsign === null) return null;
    return this.options.sources.airlines[observation.callsign.slice(0, 3)] ?? null;
  }

  /**
   * How an aircraft may be described to a listener.
   *
   * SPEC §3.2 as amended: plain English by type, never an identifier. Type code
   * first, emitter category as the fallback, then a floor — so an unknown aircraft
   * degrades to "a plane" rather than to a code or, worse, a callsign.
   */
  private describe(observation: Observation): string {
    const vocabulary = this.options.sources.aircraft_vocabulary;
    const byType =
      observation.typeCode === null ? undefined : vocabulary.by_type[observation.typeCode];
    if (byType !== undefined) return byType;
    // `identity` exists for exactly this decision and was being ignored: a Bombardier
    // Global Express flying without an airline callsign is emitter category A3, so it
    // was captioned "an airliner" when §3.2 wants "a large private jet".
    const table =
      observation.identity === 'private' ? vocabulary.by_category_private : vocabulary.by_category;
    const byCategory = observation.category === null ? undefined : table[observation.category];
    return byCategory ?? vocabulary.fallback;
  }

  /**
   * Caption text, from templates in config.
   *
   * SPEC §3.2 as amended: a caption **never contains a raw callsign**. Phase 1 adds
   * operator and route, and only when a route resolves AND one of its endpoints
   * matches the airport we observed. Until then every caption is type-based, which is
   * the correct degraded form rather than a placeholder.
   */
  private captionFor(
    type: EventType,
    describedAs: string,
    operator: string | null,
    bearingDegrees: number,
  ): string {
    const templates = this.options.sources.captions;
    const caption = fillCaption(templates[type], {
      aircraft: describedAs,
      place: templates.place,
      direction: compassPoint(templates.compass, bearingDegrees),
    });
    if (operator === null) return caption;
    return caption + templates.operator_suffix.replace('{operator}', operator);
  }

  private buildEvent(
    type: EventType,
    observation: Observation,
    distanceToOrigin: number,
    heavy: boolean,
  ): CityEvent {
    const describedAs = this.describe(observation);
    const operator = this.operatorFor(observation);
    const bearing = bearingDeg(this.origin, observation);
    const precision = this.options.sources.precision;
    return {
      id: this.makeId(),
      t: observation.t,
      type,
      source: observation.source,
      geo: { lat: observation.lat, lon: observation.lon, alt_ft: observation.altFt },
      rel: {
        bearing_deg: round(bearing, precision.bearing_deg),
        distance_km: round(distanceToOrigin, precision.distance_km),
      },
      attrs: {
        callsign: observation.callsign,
        operator,
        category: observation.category,
        type_code: observation.typeCode,
        vrate_fpm: observation.verticalRateFpm,
        heavy,
        described_as: describedAs,
      },
      salience: round(this.salienceFor(type, distanceToOrigin, heavy), precision.salience),
      caption: this.captionFor(type, describedAs, operator, bearing),
      sim: false,
      scheduled: false,
    };
  }
}

/** Fill a caption template from config. */
export function fillCaption(
  template: string,
  values: { aircraft: string; place: string; direction?: string },
): string {
  return template
    .replace('{aircraft}', values.aircraft)
    .replace('{place}', values.place)
    .replace('{direction}', values.direction ?? '');
}

/**
 * A bearing as a spoken compass point.
 *
 * Eight points, not sixteen: "north-north-east" is navigation, and a caption is
 * something a person reads in one glance while listening to something else.
 */
export function compassPoint(points: readonly string[], bearingDegrees: number): string {
  const index = Math.round((((bearingDegrees % 360) + 360) % 360) / 45) % points.length;
  return points[index] ?? points[0] ?? '';
}
