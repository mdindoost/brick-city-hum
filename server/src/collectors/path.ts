/**
 * PATH trains at Newark Penn and Harrison. SPEC §3.1 R3, §3.3.
 *
 * The Port Authority's own JSON — the feed behind their departure boards. Keyless,
 * undocumented, and therefore treated as a courtesy rather than an entitlement: a
 * 30 s interval with jitter, a short timeout, backoff on failure, and a User-Agent
 * that says who we are (§9.1).
 *
 * **The feed gives no train identity**, only a countdown per platform. So a train is
 * not tracked; a *threshold crossing* is. The minimum countdown on a platform falls
 * steadily, crosses the approach gate, crosses the arrival gate, and then jumps back
 * up as the next train becomes the nearest — which rearms the platform. This is the
 * same edge-not-state reasoning as the aircraft gates in `detector.ts`, and for the
 * same reason: testing "countdown < 45" rather than the crossing would fire on every
 * poll of the last minute.
 *
 * One collector per source, no shared cleverness (§5.1): this file knows nothing
 * about aircraft and nothing about the next rail source.
 */

import { z } from 'zod';
import { ulid } from 'ulid';
import type { CityEvent } from '../events.js';
import type { PlacesConfig, SourcesConfig } from '../config.js';
import { bearingDeg, distanceKm } from '../geo.js';
import { fetchJson, Poller } from '../poller.js';
import type { HealthRegistry } from '../health.js';

/**
 * The response shape, validated at the boundary.
 *
 * Deliberately loose about everything we do not use: an undocumented feed may add or
 * rename fields at any time, and a schema that insists on the whole document would
 * turn a cosmetic change at the Port Authority into silence here.
 */
const messageSchema = z.object({
  target: z.string().optional(),
  secondsToArrival: z.union([z.string(), z.number()]),
  headSign: z.string().optional(),
  lineColor: z.string().optional(),
});

const ridePathSchema = z.object({
  results: z.array(
    z.object({
      consideredStation: z.string(),
      destinations: z.array(
        z.object({
          label: z.string().optional(),
          messages: z.array(messageSchema).optional(),
        }),
      ),
    }),
  ),
});

export interface PlatformCountdown {
  /** Feed station code, e.g. `NWK`. */
  readonly station: string;
  /** Direction label from the feed, e.g. `ToNY`. */
  readonly label: string;
  /** Seconds until the **nearest** train on this platform. */
  readonly seconds: number;
  readonly headSign: string | null;
}

/** The nearest train on each platform. Invalid or missing countdowns are skipped. */
export function parseRidePath(body: unknown): {
  platforms: PlatformCountdown[];
  skipped: number;
} {
  const parsed = ridePathSchema.safeParse(body);
  if (!parsed.success) return { platforms: [], skipped: 1 };

  const platforms: PlatformCountdown[] = [];
  let skipped = 0;
  for (const result of parsed.data.results) {
    for (const destination of result.destinations) {
      let nearest: PlatformCountdown | null = null;
      for (const message of destination.messages ?? []) {
        const seconds = Number(message.secondsToArrival);
        if (!Number.isFinite(seconds) || seconds < 0) {
          skipped += 1;
          continue;
        }
        if (nearest === null || seconds < nearest.seconds) {
          nearest = {
            station: result.consideredStation,
            label: destination.label ?? '',
            seconds,
            headSign: message.headSign ?? null,
          };
        }
      }
      if (nearest !== null) platforms.push(nearest);
    }
  }
  return { platforms, skipped };
}

type Gate = 'path_approaching' | 'path_arrival';

interface PlatformState {
  /** Gates already fired for the train currently nearest this platform. */
  fired: Set<Gate>;
}

export interface PathDetectorOptions {
  readonly sources: SourcesConfig;
  readonly places: PlacesConfig;
  readonly makeId?: () => string;
}

/**
 * Turns countdowns into events.
 *
 * Separate from the polling so it can be tested against a recorded response without
 * a network, which is how every aircraft rule in this project earned its confidence.
 */
export class PathDetector {
  private readonly states = new Map<string, PlatformState>();
  private readonly makeId: () => string;

  constructor(private readonly options: PathDetectorOptions) {
    this.makeId = options.makeId ?? ulid;
  }

  detect(platforms: readonly PlatformCountdown[], at: number): CityEvent[] {
    const config = this.options.sources.rail.path;
    const events: CityEvent[] = [];

    for (const platform of platforms) {
      const placeId = config.stations[platform.station];
      if (placeId === undefined) continue; // a station we are not listening to
      const place = this.options.places.places[placeId];
      if (place === undefined) continue;

      const key = `${platform.station}|${platform.label}`;
      const state = this.states.get(key) ?? { fired: new Set<Gate>() };
      this.states.set(key, state);

      // The countdown has climbed well clear: this is the next train, so the
      // platform may speak again.
      if (platform.seconds > config.rearm_s) state.fired.clear();

      // A train first seen inside the arrival gate gets one bell, not two. Firing
      // both in the same poll is technically true and musically wrong: the approach
      // exists to precede the arrival, and two struck notes at the same instant read
      // as one louder note rather than as an approach.
      const atArrival = platform.seconds <= config.arriving_s;
      if (atArrival) state.fired.add('path_approaching');

      for (const [gate, threshold] of [
        ['path_approaching', config.approaching_s],
        ['path_arrival', config.arriving_s],
      ] as const) {
        if (platform.seconds <= threshold && !state.fired.has(gate)) {
          state.fired.add(gate);
          events.push(this.build(gate, platform, place, at));
        }
      }
    }
    return events;
  }

  private build(
    type: Gate,
    platform: PlatformCountdown,
    place: { name: string; lat: number; lon: number },
    at: number,
  ): CityEvent {
    const origin = this.options.places.origin;
    const precision = this.options.sources.precision;
    const salience = this.options.sources.salience;
    const round = (value: number, places: number): number => {
      const factor = 10 ** places;
      return Math.round(value * factor) / factor;
    };
    const distance = distanceKm(origin, place);
    return {
      id: this.makeId(),
      t: at,
      type,
      source: 'path',
      // A station does not move, so the geography is the station's own.
      geo: { lat: place.lat, lon: place.lon, alt_ft: null },
      rel: {
        bearing_deg: round(bearingDeg(origin, place), precision.bearing_deg),
        distance_km: round(distance, precision.distance_km),
      },
      attrs: {
        callsign: null,
        operator: null,
        category: null,
        type_code: null,
        vrate_fpm: null,
        track_deg: null,
        heavy: false,
        described_as: 'a PATH train',
      },
      salience: round(salience[type], precision.salience),
      caption: this.options.sources.captions[type]
        .replace('{station}', place.name)
        .replace('{toward}', platform.headSign ?? platform.label),
      sim: false,
      scheduled: false,
    };
  }
}

/**
 * The polling half: one source, one loop, and the same manners as every other
 * collector (§9.1) — jittered interval, timeout, backoff, health reporting.
 */
export interface PathCollectorOptions {
  readonly sources: SourcesConfig;
  readonly places: PlacesConfig;
  readonly health: HealthRegistry;
  readonly userAgent: string;
  readonly onEvents?: (events: readonly CityEvent[], receivedAt: number) => void;
  readonly deps?: {
    readonly fetchJson?: typeof fetchJson;
    readonly now?: () => number;
    readonly random?: () => number;
  };
}

export class PathCollector {
  readonly detector: PathDetector;
  private readonly poller: Poller;
  private eventsEmitted = 0;

  constructor(private readonly options: PathCollectorOptions) {
    const config = options.sources.rail.path;
    this.detector = new PathDetector({ sources: options.sources, places: options.places });
    this.poller = new Poller(
      {
        id: 'path',
        intervalMs: config.poll_interval_ms,
        jitterMs: config.jitter_ms,
        timeoutMs: config.timeout_ms,
        // The aircraft backoff curve, reused deliberately: it is a manners policy
        // (§9.1), not an aircraft one, and a second copy would drift.
        backoff: {
          initialMs: options.sources.aircraft.backoff.initial_ms,
          multiplier: options.sources.aircraft.backoff.multiplier,
          maxMs: options.sources.aircraft.backoff.max_ms,
        },
        userAgent: options.userAgent,
      },
      () => config.url,
      (body, receivedAt) => {
        const { platforms, skipped } = parseRidePath(body);
        const events = this.detector.detect(platforms, receivedAt);
        this.eventsEmitted += events.length;
        if (events.length > 0) options.onEvents?.(events, receivedAt);
        return { count: platforms.length, skipped };
      },
      options.health,
      {
        fetchJson: options.deps?.fetchJson ?? fetchJson,
        now: options.deps?.now ?? Date.now,
        /* Request jitter must be unpredictable to spread load; §5's seeded-PRNG rule
           is about what is heard and seen. */
        // eslint-disable-next-line no-restricted-properties
        random: options.deps?.random ?? Math.random,
      },
    );
  }

  get events(): number {
    return this.eventsEmitted;
  }

  start(): void {
    if (this.options.sources.rail.path.enabled) this.poller.start();
  }

  stop(): void {
    this.poller.stop();
  }
}
