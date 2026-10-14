/**
 * Config loading and validation.
 *
 * SPEC §5: every tuning value lives in `config/*.yaml`, not in code, because the
 * aesthetic is tuned continuously after launch by people who are not editing
 * TypeScript. This module is the only place that reads those files.
 *
 * Validation is deliberately stricter than "is it a number". A swapped or mistyped
 * Newark coordinate stays comfortably inside ±90/±180, so type and range checks
 * catch nothing that matters: the server would start, report healthy, and compute
 * every bearing from a point in the Southern Ocean. So we also check a plausibility
 * box around the Newark area, and require each reference point §3.2 names to be
 * present by name rather than accepting whatever keys the file happens to have.
 *
 * Hot-reload in development (SPEC §5) is not implemented yet — it belongs with the
 * admin page's score reload in §9.5. That is also why `loadPlaces` takes its
 * directory as an argument: the config path must not be frozen at module load.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * Everything in `places.yaml` is in or around Newark. This box is the check that
 * actually catches a human mistake — a transposed lat/lon, a dropped minus sign, a
 * one-digit slip — all of which pass a global range check.
 *
 * If the project ever legitimately needs a point outside it, widen the box
 * deliberately; do not delete the check.
 */
const NEWARK_AREA = { minLat: 40.4, maxLat: 41.1, minLon: -74.6, maxLon: -73.7 } as const;

const PLAUSIBILITY_MESSAGE =
  `coordinate is outside the Newark area ` +
  `(lat ${String(NEWARK_AREA.minLat)}…${String(NEWARK_AREA.maxLat)}, ` +
  `lon ${String(NEWARK_AREA.minLon)}…${String(NEWARK_AREA.maxLon)}). ` +
  `A swapped or mistyped lat/lon stays inside the globally valid range, so this is the real check.`;

function isInNewarkArea(point: { lat: number; lon: number }): boolean {
  return (
    point.lat >= NEWARK_AREA.minLat &&
    point.lat <= NEWARK_AREA.maxLat &&
    point.lon >= NEWARK_AREA.minLon &&
    point.lon <= NEWARK_AREA.maxLon
  );
}

const placeFields = z.object({
  name: z.string().min(1),
  lat: latitude,
  lon: longitude,
  source: z.string().optional(),
});

const placeSchema = placeFields.refine(isInNewarkArea, { message: PLAUSIBILITY_MESSAGE });

const originSchema = placeFields
  .extend({ id: z.string().min(1) })
  .refine(isInNewarkArea, { message: PLAUSIBILITY_MESSAGE });

const runwaySchema = z.object({
  id: z.string().min(1),
  threshold: z
    .object({ lat: latitude, lon: longitude })
    .refine(isInNewarkArea, { message: PLAUSIBILITY_MESSAGE }),
  // Bearings are [0, 360) everywhere in this project, so 360 is not a valid heading.
  true_heading_deg: z.number().min(0).lt(360),
  length_ft: z.number().positive(),
});

/**
 * The reference points SPEC §3.2 names, required by name.
 *
 * An open record would let `ewr:` be renamed to `eww:` and load happily, with the
 * failure arriving at first use in the detector rather than at boot. It would also
 * type every lookup as possibly-undefined under `noUncheckedIndexedAccess`, pushing
 * `!` assertions into every call site.
 */
const placesSchema = z.object({
  origin: originSchema,
  places: z.object({
    ewr: placeSchema,
    newark_penn: placeSchema,
    prudential_center: placeSchema,
    port_newark: placeSchema,
  }),
  ewr_runways: z.array(runwaySchema).min(1),
});

export type PlacesConfig = z.infer<typeof placesSchema>;
export type Place = z.infer<typeof placeSchema>;

/**
 * Resolve the config directory relative to the repository, not the current working
 * directory. `process.cwd()` works when running from the repo root but breaks under
 * a Docker WORKDIR or when running the built output from `dist/` (SPEC §11.1 puts
 * this in a container, so P0-4 would have hit it).
 */
export function defaultConfigDir(): string {
  const fromEnv = process.env['CONFIG_DIR'];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
  }
  return resolve(import.meta.dirname, '..', '..', 'config');
}

function readYamlFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read config file ${path}`, { cause });
  }
  try {
    return parseYaml(text);
  } catch (cause) {
    // Report the parser's own message, with its line and column. Burying it in
    // `.cause` means the one diagnostic that would locate the typo never gets seen.
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${path} is not valid YAML: ${detail}`, { cause });
  }
}

const sourceSchema = z.object({
  id: z.string().min(1),
  url_template: z.string().min(1),
  interval_s: z.number().positive(),
  jitter_s: z.number().min(0),
  timeout_ms: z.number().positive(),
  enabled: z.boolean(),
});

const sourcesSchema = z.object({
  aircraft: z.object({
    radius_nm: z.number().positive(),
    track: z.object({
      max_observations: z.number().int().positive(),
      expire_after_s: z.number().positive(),
    }),
    sources: z.array(sourceSchema).min(1),
    backoff: z.object({
      initial_ms: z.number().positive(),
      multiplier: z.number().gt(1),
      max_ms: z.number().positive(),
      failures_before_degraded: z.number().int().positive(),
    }),
  }),
  // Typed properly rather than as an open record: an earlier version validated this
  // only as record<string, record<string, number|string>>, so a mistyped threshold
  // (`below_ft: "10000"`) booted fine and surfaced later inside the detector.
  detection: z.object({
    exit_hysteresis_km: z.number().min(0),
    ewr_departure: z.object({
      within_nm_of_ewr: z.number().positive(),
      altitude_gate_ft: z.number().positive(),
      min_climb_fpm: z.number().positive(),
      previous_below_ft: z.number().positive(),
      min_ground_observations: z.number().int().positive(),
      go_around_descent_fpm: z.number().negative(),
    }),
    ewr_arrival: z.object({
      within_nm_of_ewr: z.number().positive(),
      altitude_gate_ft: z.number().positive(),
      max_descent_fpm: z.number().negative(),
      max_landing_climb_fpm: z.number(),
      max_landing_speed_kt: z.number().positive(),
    }),
    overflight_city: z.object({
      within_km_of_origin: z.number().positive(),
      below_ft: z.number().positive(),
    }),
    overflight_high: z.object({
      within_km_of_origin: z.number().positive(),
      above_ft: z.number().positive(),
    }),
    helicopter: z.object({
      emitter_category: z.string().min(1),
      below_ft: z.number().positive(),
      within_km_of_origin: z.number().positive(),
    }),
    heavy: z.object({ emitter_category: z.string().min(1) }),
  }),
  salience: z.object({
    ewr_departure: z.number().min(0).max(1),
    ewr_arrival: z.number().min(0).max(1),
    overflight_city: z.number().min(0).max(1),
    overflight_high: z.number().min(0).max(1),
    helicopter: z.number().min(0).max(1),
    heavy_bonus: z.number().min(0).max(1),
    distance_falloff_km: z.number().positive(),
    proximity_floor: z.number().min(0).max(1),
    proximity_ceiling: z.number().min(0).max(1),
  }),
  aircraft_vocabulary: z.object({
    by_type: z.record(z.string(), z.string()),
    by_category: z.record(z.string(), z.string()),
    by_category_private: z.record(z.string(), z.string()),
    fallback: z.string().min(1),
  }),
  captions: z.object({
    place: z.string().min(1),
    ewr_departure: z.string().min(1),
    ewr_arrival: z.string().min(1),
    overflight_city: z.string().min(1),
    overflight_high: z.string().min(1),
    helicopter: z.string().min(1),
  }),
});

export type SourcesConfig = z.infer<typeof sourcesSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;

/** Load and validate `sources.yaml`. */
export function loadSources(configDir: string = defaultConfigDir()): SourcesConfig {
  const path = join(configDir, 'sources.yaml');
  const result = sourcesSchema.safeParse(readYamlFile(path));
  if (!result.success) {
    throw new Error(`${path} is invalid:\n${z.prettifyError(result.error)}`);
  }
  const enabled = result.data.aircraft.sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    // Every source disabled would start a server that silently never collects
    // anything — indistinguishable from a permanently quiet city.
    throw new Error(`${path}: no aircraft source is enabled`);
  }
  return result.data;
}

/**
 * Load and validate `places.yaml`.
 *
 * Throws on any problem. That is deliberate: a server running with bad geography
 * would place the whole city wrongly in the stereo field while appearing healthy,
 * which is worse than not starting.
 */
export function loadPlaces(configDir: string = defaultConfigDir()): PlacesConfig {
  const path = join(configDir, 'places.yaml');
  const result = placesSchema.safeParse(readYamlFile(path));
  if (!result.success) {
    throw new Error(`${path} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
