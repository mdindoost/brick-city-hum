/**
 * Listener taps. SPEC §8.
 *
 * The people layer, and the only events in this project that someone chose to make.
 *
 * **Every limit here is server-side on purpose.** A client-side limit is a
 * suggestion: anyone can open devtools, and the first person who does would become
 * the whole piece for everyone else. §8 sets a per-connection interval, a global
 * ceiling, and excess dropped by recency — newest first, so a burst from one tab
 * cannot starve the listener who tapped once.
 *
 * **Nothing here is stored with an identifier** (§8, §3.7). The limiter keys on the
 * socket object itself, which disappears when the socket does, and the department
 * travels no further than a colour. There is no IP, no cookie and no id in a tap
 * event — a tap is anonymous in the structural sense that there is nothing to leak.
 */

import { ulid } from 'ulid';
import type { CityEvent } from './events.js';
import type { PlacesConfig, SourcesConfig } from './config.js';

export interface TapInput {
  readonly x: number;
  readonly y: number;
  readonly department: string | null;
}

export class TapLimiter {
  /** Last accepted tap per connection. Keyed on the socket, so it cannot outlive it. */
  private readonly lastByConnection = new WeakMap<object, number>();
  /** Timestamps of recently accepted taps, for the global ceiling. */
  private recent: number[] = [];

  constructor(
    private readonly options: { readonly sources: SourcesConfig; readonly places: PlacesConfig },
  ) {}

  /**
   * Accept or refuse a tap.
   *
   * Returns the event when accepted and null when refused. Refusal is silent to the
   * sender beyond its own optimistic sound: §8 plays the tap locally first, so the
   * person who tapped always hears themselves even when the city is too busy to
   * carry it to everyone else.
   */
  accept(connection: object, input: TapInput, now: number): CityEvent | null {
    const limits = this.options.sources.taps;
    if (!limits.enabled) return null;

    const last = this.lastByConnection.get(connection);
    if (last !== undefined && now - last < limits.min_interval_ms) return null;

    this.recent = this.recent.filter((t) => now - t < 1000);
    if (this.recent.length >= limits.global_per_second) return null;

    this.lastByConnection.set(connection, now);
    this.recent.push(now);
    return this.build(input, now);
  }

  private build(input: TapInput, now: number): CityEvent {
    const sources = this.options.sources;
    const origin = this.options.places.origin;
    const x = clamp01(input.x);
    const y = clamp01(input.y);
    // §8's mapping. x is pitch across two octaves of the current scale, y is the
    // instrument family (top = bells, bottom = soft piano), and the distance from the
    // centre of the screen is the pan — which is why the bearing is computed from the
    // tap itself and not from any geography.
    const degree = Math.round(x * 9) - 4;
    const register = y < 0.34 ? 2 : y < 0.67 ? 1 : 0;
    const bearing = ((Math.atan2(x - 0.5, 0.5 - y) * 180) / Math.PI + 360) % 360;
    const spread = Math.hypot(x - 0.5, y - 0.5) * 2;

    const department =
      input.department !== null && sources.taps.departments.includes(input.department)
        ? input.department
        : null;

    return {
      id: ulid(),
      t: now,
      type: 'tap',
      source: 'listener',
      // A tap has no place in the city. It is placed at the listener, which is where
      // the person doing it is standing as far as this piece is concerned.
      geo: { lat: origin.lat, lon: origin.lon, alt_ft: null },
      rel: {
        bearing_deg: Number(bearing.toFixed(0)),
        distance_km: Number((spread * 2).toFixed(2)),
      },
      attrs: {
        callsign: null,
        operator: null,
        category: null,
        type_code: null,
        vrate_fpm: null,
        track_deg: null,
        heavy: false,
        described_as: 'a listener',
      },
      tap: { degree, register, department },
      salience: sources.salience.tap,
      tier: 'voice',
      caption: sources.captions.tap,
      sim: false,
      scheduled: false,
    };
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}
