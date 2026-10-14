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
  readonly inside: Set<EventType>;
}

export interface DetectorOptions {
  readonly places: PlacesConfig;
  readonly sources: SourcesConfig;
  /** Injectable so tests get deterministic ids and the lab can reproduce a render. */
  readonly makeId?: () => string;
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
      this.looksLikeItLeftTheGround(track, detection.ewr_departure.previous_below_ft)
    ) {
      state.fired.add('ewr_departure');
      events.push(this.buildEvent('ewr_departure', current, distanceToOrigin, heavy));
    }

    // --- EWR arrival ---------------------------------------------------------
    // Either a descent through the gate, or a transition to the ground — the second
    // catches aircraft whose descent we never saw because they appeared late.
    const landedNow = previous !== undefined && !previous.onGround && current.onGround;
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
    if (
      this.crossedInto(
        'overflight_city',
        state,
        cityInside,
        distanceToOrigin,
        detection.overflight_city.within_km_of_origin,
      )
    ) {
      events.push(this.buildEvent('overflight_city', current, distanceToOrigin, heavy));
    }

    const highInside =
      distanceToOrigin <= detection.overflight_high.within_km_of_origin &&
      current.altFt !== null &&
      current.altFt >= detection.overflight_high.above_ft;
    if (
      this.crossedInto(
        'overflight_high',
        state,
        highInside,
        distanceToOrigin,
        detection.overflight_high.within_km_of_origin,
      )
    ) {
      events.push(this.buildEvent('overflight_high', current, distanceToOrigin, heavy));
    }

    // --- Helicopter ----------------------------------------------------------
    const heliInside =
      current.category === detection.helicopter.emitter_category &&
      distanceToOrigin <= detection.helicopter.within_km_of_origin &&
      current.altFt !== null &&
      current.altFt < detection.helicopter.below_ft;
    if (
      this.crossedInto(
        'helicopter',
        state,
        heliInside,
        distanceToOrigin,
        detection.helicopter.within_km_of_origin,
      )
    ) {
      events.push(this.buildEvent('helicopter', current, distanceToOrigin, heavy));
    }

    return events;
  }

  /**
   * Zone entry with hysteresis: enter at the radius, leave only once well beyond it.
   *
   * Returns true on the transition into the zone. The aircraft must get
   * `exit_hysteresis_km` clear of the boundary before it can trigger again — without
   * that, one hovering helicopter retriggers its voice every 10 seconds.
   */
  private crossedInto(
    type: EventType,
    state: AircraftState,
    isInside: boolean,
    distanceKmNow: number,
    radiusKm: number,
  ): boolean {
    const wasInside = state.inside.has(type);
    if (isInside) {
      if (wasInside) return false;
      state.inside.add(type);
      return true;
    }
    if (wasInside && distanceKmNow > radiusKm + this.options.sources.detection.exit_hysteresis_km) {
      state.inside.delete(type);
    }
    return false;
  }

  /**
   * Distinguish a real departure from a go-around.
   *
   * §3.2's rule — "the previous observation was on ground or below 500 ft" — is
   * satisfied by a go-around too: an aircraft that descends to 300 ft, does not land,
   * and climbs away would be captioned as a departure. It is not one, and at a busy
   * airport this is a routine event rather than an exotic edge case.
   *
   * So: accept if the aircraft was seen on the ground in the window (unambiguous), or
   * if its climb began from low altitude with no descent before it. A go-around has a
   * descent immediately before the climb; a departure does not.
   *
   * *This is a deliberate strengthening of §3.2 and is recorded in docs/decisions.md.*
   */
  private looksLikeItLeftTheGround(track: readonly Observation[], belowFt: number): boolean {
    if (track.some((observation) => observation.onGround)) return true;

    // Walk back to where the climb began.
    let index = track.length - 1;
    while (index > 0) {
      const earlier = track[index - 1];
      if (earlier === undefined) break;
      if (earlier.altFt === null || earlier.altFt >= belowFt) break;
      index -= 1;
    }
    const climbStart = track[index];
    if (climbStart === undefined) return false;
    if (climbStart.altFt !== null && climbStart.altFt >= belowFt) return false;

    // Anything before the climb that was descending means this was an approach the
    // aircraft abandoned, not a takeoff.
    for (let i = 0; i < index; i += 1) {
      const earlier = track[i];
      if (earlier !== undefined && (earlier.verticalRateFpm ?? 0) < 0) return false;
    }
    return true;
  }

  private salienceFor(type: EventType, distanceKmNow: number, heavy: boolean): number {
    const config = this.options.sources.salience;
    const base = config[type];
    const withHeavy = base + (heavy ? config.heavy_bonus : 0);
    const proximity = 1 - distanceKmNow / config.distance_falloff_km;
    const scaled = withHeavy * Math.min(1, Math.max(0.2, proximity));
    return Math.min(1, Math.max(0, scaled));
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
    const byCategory =
      observation.category === null ? undefined : vocabulary.by_category[observation.category];
    return byCategory ?? vocabulary.fallback;
  }

  private buildEvent(
    type: EventType,
    observation: Observation,
    distanceToOrigin: number,
    heavy: boolean,
  ): CityEvent {
    const describedAs = this.describe(observation);
    return {
      id: this.makeId(),
      t: observation.t,
      type,
      source: observation.source,
      geo: { lat: observation.lat, lon: observation.lon, alt_ft: observation.altFt },
      rel: {
        bearing_deg: bearingDeg(this.origin, observation),
        distance_km: distanceToOrigin,
      },
      attrs: {
        callsign: observation.callsign,
        category: observation.category,
        type_code: observation.typeCode,
        vrate_fpm: observation.verticalRateFpm,
        heavy,
        described_as: describedAs,
      },
      salience: this.salienceFor(type, distanceToOrigin, heavy),
      caption: captionFor(type, describedAs),
      sim: false,
      scheduled: false,
    };
  }
}

/**
 * Caption text. SPEC §3.2 as amended: a caption **never contains a raw callsign**.
 *
 * Phase 1 adds operator and route, and only when a route resolves AND one of its
 * endpoints matches the airport we observed — a route whose endpoints are elsewhere
 * is not about this flight. Until then every caption is type-based, which is the
 * correct degraded form rather than a placeholder.
 */
export function captionFor(type: EventType, describedAs: string): string {
  switch (type) {
    case 'ewr_departure':
      return `✈ ${describedAs} departing Newark`;
    case 'ewr_arrival':
      return `✈ ${describedAs} arriving at Newark`;
    case 'overflight_city':
      return `✈ ${describedAs} over the city`;
    case 'overflight_high':
      return `✈ ${describedAs} high above Newark`;
    case 'helicopter':
      return `🚁 ${describedAs} crossing Newark`;
  }
}
