/**
 * Test helpers. Imported only from `*.test.ts`, never from the server.
 *
 * These load the **real** `config/*.yaml` rather than hand-written stubs. A stub
 * drifts from the config it mirrors, and worse, it lets a test pass against
 * thresholds nobody uses. Tests that need different values override just those.
 */

import { loadPlaces, loadSources, type PlacesConfig, type SourcesConfig } from './config.js';
import type { Observation } from './observation.js';

export function realPlaces(): PlacesConfig {
  return loadPlaces();
}

export function realSources(): SourcesConfig {
  return loadSources();
}

/**
 * The real config with its source list replaced, for tests that must not touch the
 * network. Everything else — thresholds, backoff, vocabulary — stays real.
 */
export function sourcesWithFakeFeeds(): SourcesConfig {
  const real = realSources();
  return {
    ...real,
    aircraft: {
      ...real.aircraft,
      sources: [
        {
          id: 'primary',
          url_template: 'https://primary.invalid/{lat}/{lon}/{radius_nm}',
          interval_s: 10,
          jitter_s: 0,
          timeout_ms: 8000,
          enabled: true,
        },
        {
          id: 'fallback',
          url_template: 'https://fallback.invalid/{lat}/{lon}/{radius_nm}',
          interval_s: 15,
          jitter_s: 0,
          timeout_ms: 8000,
          enabled: true,
        },
      ],
    },
  };
}

/** A plausible observation. Override only what a test is actually about. */
export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    icao: 'a4460f',
    t: 1760458800123,
    lat: 40.69,
    lon: -74.17,
    altFt: 1600,
    onGround: false,
    verticalRateFpm: 2200,
    groundSpeedKt: 210,
    category: 'A3',
    identity: 'airline',
    callsign: 'UAL1810',
    typeCode: 'B738',
    source: 'adsb.lol',
    positionAgeS: 0.4,
    ...overrides,
  };
}
