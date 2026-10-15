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
  // Named entries are required because code refers to them directly; `catchall`
  // admits the rest, so adding a station to places.yaml needs no schema change.
  places: z
    .object({
      ewr: placeSchema,
      newark_penn: placeSchema,
      harrison_path: placeSchema,
      prudential_center: placeSchema,
      port_newark: placeSchema,
    })
    .catchall(placeSchema),
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
    startup_delay_ms: z.number().min(0),
    startup_jitter_ms: z.number().min(0),
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
      landing_within_nm_of_ewr: z.number().positive(),
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
      // Either signal identifies a rotorcraft: see the comment in sources.yaml.
      type_codes: z.array(z.string().min(1)),
      below_ft: z.number().positive(),
      within_km_of_origin: z.number().positive(),
    }),
    heavy: z.object({ emitter_category: z.string().min(1) }),
    /** Exit band as a fraction of each ring's radius. See sources.yaml. */
    ring_hysteresis_fraction: z.number().min(0).max(1),
    /** Ring radii in km. See sources.yaml. */
    rings: z.array(z.number().positive()).min(1),
    /** Fire when an aircraft crosses a ring outward as well as inward. */
    rings_on_exit: z.boolean(),
    /** Altitude thresholds in feet, crossed in either direction. */
    altitude_bands_ft: z.array(z.number().positive()).min(1),
    altitude_band_within_km: z.number().positive(),
  }),
  precision: z.object({
    bearing_deg: z.number().int().min(0).max(6),
    distance_km: z.number().int().min(0).max(6),
    salience: z.number().int().min(0).max(6),
  }),
  rail: z.object({
    path: z.object({
      enabled: z.boolean(),
      url: z.string().url(),
      poll_interval_ms: z.number().positive(),
      jitter_ms: z.number().min(0),
      timeout_ms: z.number().positive(),
      /** Feed station code -> a key in places.yaml's `places`. */
      stations: z.record(z.string(), z.string()),
      approaching_s: z.number().positive(),
      arriving_s: z.number().positive(),
      rearm_s: z.number().positive(),
    }),
  }),
  sky: z.object({
    enabled: z.boolean(),
    interval_s: z.number().positive(),
    dayparts: z.array(z.object({ name: z.string().min(1), sun_below_deg: z.number() })).min(2),
    moments: z.object({ sunrise: z.boolean(), sunset: z.boolean() }),
  }),
  taps: z.object({
    enabled: z.boolean(),
    min_interval_ms: z.number().positive(),
    global_per_second: z.number().positive(),
    departments: z.array(z.string().min(1)).min(1),
  }),
  salience: z.object({
    sky: z.number().min(0).max(1),
    altitude_band: z.number().min(0).max(1),
    sunrise: z.number().min(0).max(1),
    tap: z.number().min(0).max(1),
    sunset: z.number().min(0).max(1),
    path_approaching: z.number().min(0).max(1),
    path_arrival: z.number().min(0).max(1),
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
  /** ICAO callsign prefix -> scheduled airline name. See sources.yaml. */
  airlines: z.record(z.string(), z.string()),
  aircraft_vocabulary: z.object({
    by_type: z.record(z.string(), z.string()),
    by_category: z.record(z.string(), z.string()),
    by_category_private: z.record(z.string(), z.string()),
    fallback: z.string().min(1),
  }),
  simulator: z.object({
    enabled: z.boolean(),
    takeover_after_s: z.number().positive(),
    intensity: z.number().positive(),
    caption_suffix: z.string().min(1),
    window_s: z.number().positive(),
  }),
  captions: z.object({
    place: z.string().min(1),
    ewr_departure: z.string().min(1),
    ewr_arrival: z.string().min(1),
    overflight_city: z.string().min(1),
    overflight_high: z.string().min(1),
    helicopter: z.string().min(1),
    sky_by_distance: z
      .array(z.object({ within_km: z.number().positive(), text: z.string().min(1) }))
      .min(1),
    altitude_band: z.string().min(1),
    sunrise: z.string().min(1),
    tap: z.string().min(1),
    sunset: z.string().min(1),
    climbing: z.string().min(1),
    descending: z.string().min(1),
    path_approaching: z.string().min(1),
    path_arrival: z.string().min(1),
    compass: z.array(z.string().min(1)).length(8),
    operator_suffix: z.string().min(1),
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

/**
 * `score.yaml` — every musical and visual value (SPEC §1.5, §5).
 *
 * Separate from `sources.yaml` on purpose: that file is how the city is *observed*
 * and this one is how it is *rendered*. The music director edits this one and should
 * never have to read the other.
 */
const figureSchema = z.object({
  notes: z.number().int().min(1).max(6),
  step_degrees: z.number().int(),
  attack_s: z.number().min(0),
  release_s: z.number().positive(),
  gap_beats_slow: z.number().positive(),
  gap_beats_fast: z.number().positive(),
  vrate_fast_fpm: z.number().positive(),
  gain: z.number().min(0).max(1),
});

const scoreSchema = z.object({
  play_lead_ms: z.number().positive(),
  governor: z.object({
    window_s: z.number().positive(),
    day_from_hour: z.number().int().min(0).max(23),
    night_from_hour: z.number().int().min(0).max(23),
    day: z.object({ min: z.number().min(0), max: z.number().positive() }),
    night: z.object({ min: z.number().min(0), max: z.number().positive() }),
    texture_gain: z.number().min(0).max(1),
  }),
  visual: z.object({
    horizon_km: z.number().positive(),
    rings_km: z.array(z.number().positive()).min(1),
    event_life_s: z.number().positive(),
    arrival_grow_s: z.number().positive(),
    caption_lines: z.number().int().positive(),
    caption_life_s: z.number().positive(),
  }),
  audio: z.object({
    master: z.object({
      gain_db: z.number(),
      high_shelf_hz: z.number().positive(),
      high_shelf_db: z.number(),
      compressor_threshold_db: z.number(),
      compressor_ratio: z.number().positive(),
      compressor_attack_s: z.number().positive(),
      compressor_release_s: z.number().positive(),
      limiter_ceiling_db: z.number(),
      reverb_decay_s: z.number().positive(),
    }),
    transport: z.object({
      bpm: z.number().positive(),
      quantize_beats: z.number().positive(),
    }),
    palettes: z.record(
      z.string(),
      z.object({
        root_midi: z.number().int().min(0).max(127),
        scale: z.array(z.number().int()).min(1),
        ground_cutoff_hz: z.number().positive(),
        ground_gain: z.number().min(0).max(1),
      }),
    ),
    palette: z.object({
      name: z.string().min(1),
      root_midi: z.number().int().min(0).max(127),
      scale: z.array(z.number().int()).min(1),
    }),
    ground: z.object({
      midi: z.array(z.number().int().min(0).max(127)).min(1),
      gain: z.number().min(0).max(1),
      attack_s: z.number().positive(),
      loop_s: z.array(z.number().positive()).min(1),
      lfo_s: z.array(z.number().positive()).min(1),
      cutoff_hz: z.number().positive(),
      cutoff_sweep_hz: z.number().min(0),
    }),
    voices: z.object({
      max_desktop: z.number().int().positive(),
      max_mobile: z.number().int().positive(),
      min_attack_s: z.number().min(0),
      ewr_departure: figureSchema,
      ewr_arrival: figureSchema,
      overflight_city: z.object({
        attack_s: z.number().min(0),
        hold_s: z.number().min(0),
        release_s: z.number().positive(),
        detune_cents: z.number().min(0),
        bend_cents: z.number().min(0),
        gain: z.number().min(0).max(1),
      }),
      overflight_high: z.object({
        attack_s: z.number().min(0),
        release_s: z.number().positive(),
        gain: z.number().min(0).max(1),
        octave_offset: z.number().int(),
      }),
      helicopter: z.object({
        tremolo_hz: z.number().positive(),
        tremolo_depth: z.number().min(0).max(1),
        attack_s: z.number().min(0),
        hold_s: z.number().min(0),
        release_s: z.number().positive(),
        gain: z.number().min(0).max(1),
      }),
      sky: z.object({
        attack_s: z.number().min(0),
        release_s: z.number().positive(),
        gain: z.number().min(0).max(1),
      }),
      path: z.object({
        harmonicity: z.number().positive(),
        modulation_index: z.number().positive(),
        attack_s: z.number().min(0),
        decay_s: z.number().positive(),
        release_s: z.number().positive(),
        approach_octave: z.number().int(),
        approach_gain: z.number().min(0).max(1),
        arrival_gain: z.number().min(0).max(1),
      }),
      tap: z.object({
        attack_s: z.number().min(0),
        decay_s: z.number().positive(),
        release_s: z.number().positive(),
        gain: z.number().min(0).max(1),
        harmonicity: z.array(z.number().positive()).min(1),
        modulation_index: z.array(z.number().positive()).min(1),
        octave_offset: z.array(z.number().int()).min(1),
      }),
      heavy: z.object({
        octave_offset: z.number().int(),
        release_multiplier: z.number().positive(),
        cutoff_multiplier: z.number().positive(),
      }),
    }),
  }),
});

export type ScoreConfig = z.infer<typeof scoreSchema>;

/** Load and validate `score.yaml`. */
export function loadScore(configDir: string = defaultConfigDir()): ScoreConfig {
  const path = join(configDir, 'score.yaml');
  const result = scoreSchema.safeParse(readYamlFile(path));
  if (!result.success) {
    throw new Error(`${path} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
