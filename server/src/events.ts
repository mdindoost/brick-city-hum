/**
 * The normalized event — SPEC §4's schema, the single shape every collector produces
 * and the governor, recorder and client all consume.
 *
 * An event is a *musical fact* ("a departure happened"), distinct from an
 * `Observation` ("this aircraft was here at this altitude"). Observations come from a
 * poll; events are derived from several observations by a detector.
 */

import { z } from 'zod';

export const EVENT_TYPES = [
  'ewr_departure',
  'ewr_arrival',
  'overflight_city',
  'overflight_high',
  'helicopter',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const eventSchema = z.object({
  /** ULID. Sortable by creation time, which makes recordings easy to reason about. */
  id: z.string().min(1),
  /** Server epoch ms when the event happened — best estimate (SPEC §4). */
  t: z.number().int().positive(),
  type: z.enum(EVENT_TYPES),
  source: z.string().min(1),
  geo: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    alt_ft: z.number().nullable(),
  }),
  /** Relative to the origin, computed server-side. Drives pan and gain (§6.4). */
  rel: z.object({
    bearing_deg: z.number().min(0).lt(360),
    distance_km: z.number().min(0),
  }),
  attrs: z.object({
    /**
     * Operator flight number, or `null`.
     *
     * **Stripped at the WebSocket boundary** (SPEC §3.2 as amended): it exists here
     * for provenance and track keying, and must never be serialised to a client.
     * A callsign that rides along "for internal use" is recoverable from devtools.
     */
    callsign: z.string().nullable(),
    category: z.string().nullable(),
    type_code: z.string().nullable(),
    vrate_fpm: z.number().nullable(),
    /** True for ADS-B emitter category A5. Modifier, not a type (SPEC §3.2). */
    heavy: z.boolean(),
    /** How the aircraft may be described to a listener, already privacy-filtered. */
    described_as: z.string().min(1),
  }),
  /** 0..1, used by the density governor (SPEC §6.5). */
  salience: z.number().min(0).max(1),
  caption: z.string().min(1),
  sim: z.boolean(),
  scheduled: z.boolean(),
});

export type CityEvent = z.infer<typeof eventSchema>;

/**
 * The client-facing shape: everything except the fields §3.2 forbids publishing.
 *
 * Returned by value rather than by deleting keys, so adding a sensitive field to
 * `attrs` later does not silently start publishing it — the omission is explicit
 * and a reviewer can see the whole public surface in one place.
 */
export function toPublicEvent(event: CityEvent): Record<string, unknown> {
  return {
    id: event.id,
    t: event.t,
    type: event.type,
    geo: event.geo,
    rel: event.rel,
    attrs: {
      category: event.attrs.category,
      heavy: event.attrs.heavy,
      described_as: event.attrs.described_as,
    },
    salience: event.salience,
    caption: event.caption,
    sim: event.sim,
    scheduled: event.scheduled,
  };
}
