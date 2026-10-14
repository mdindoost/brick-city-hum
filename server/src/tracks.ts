/**
 * Per-aircraft track history, keyed by ICAO hex.
 *
 * SPEC §3.2: "Keep a per-aircraft track (keyed by ICAO hex) of the last ~10
 * observations." The detector (P0-5) reads these: a departure is not visible in a
 * single observation, only in a climb developing across several.
 *
 * Bounded in both directions on purpose. Per aircraft we keep a fixed window, and
 * aircraft unseen for a while are forgotten — otherwise a day of traffic over the
 * New York area would grow the store without limit on a machine that is also meant
 * to be running an audio server.
 */

import type { Observation } from './observation.js';

export interface TrackStoreOptions {
  readonly maxObservations: number;
  readonly expireAfterMs: number;
}

export class TrackStore {
  private readonly tracks = new Map<string, Observation[]>();

  constructor(private readonly options: TrackStoreOptions) {}

  /**
   * Add an observation and return the aircraft's history, newest last.
   *
   * Out-of-order and duplicate observations are handled rather than assumed away:
   * sources can repeat a position, and a retry after a backoff can deliver an older
   * reading after a newer one.
   */
  add(observation: Observation): readonly Observation[] {
    const existing = this.tracks.get(observation.icao);
    if (existing === undefined) {
      const created = [observation];
      this.tracks.set(observation.icao, created);
      return created;
    }

    const newest = existing[existing.length - 1];
    if (newest !== undefined) {
      // Exact duplicate of the latest reading: nothing new to learn, and letting it
      // in would make a stalled source look like level flight.
      if (newest.t === observation.t) {
        return existing;
      }
      // Older than what we already have: insert in order rather than appending, so
      // the detector can always trust that the last element is the most recent.
      if (observation.t < newest.t) {
        const index = existing.findIndex((entry) => entry.t > observation.t);
        existing.splice(index === -1 ? existing.length : index, 0, observation);
        if (existing.length > this.options.maxObservations) existing.shift();
        return existing;
      }
    }

    existing.push(observation);
    if (existing.length > this.options.maxObservations) existing.shift();
    return existing;
  }

  get(icao: string): readonly Observation[] {
    return this.tracks.get(icao) ?? [];
  }

  /** Drop aircraft not seen since `now - expireAfterMs`. Returns how many were dropped. */
  expire(now: number): number {
    let dropped = 0;
    for (const [icao, observations] of this.tracks) {
      const newest = observations[observations.length - 1];
      if (newest === undefined || now - newest.t > this.options.expireAfterMs) {
        this.tracks.delete(icao);
        dropped += 1;
      }
    }
    return dropped;
  }

  get size(): number {
    return this.tracks.size;
  }

  /** The aircraft currently tracked, so detector state can be kept in step. */
  icaos(): Iterable<string> {
    return this.tracks.keys();
  }
}
