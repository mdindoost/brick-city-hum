/**
 * The density governor. SPEC §6.5, §9.2.
 *
 * §1.4 is "never silent, never chaotic", and this is the half that prevents chaos.
 * It runs on the **server** so that every listener hears the same piece: a client-side
 * decision would make a busy minute sound different in two browsers, which breaks the
 * one promise the project makes about being shared.
 *
 * It **demotes rather than drops**. An event that is pushed out of the foreground
 * still happened, is still captioned and still drawn; §1.3 says every sound traces to
 * a real event, not that every event has to become a loud one. Dropping was what the
 * client's voice cap was already doing by accident — 27 of 278 events in a ten-minute
 * render, chosen by whichever arrived when the budget was full rather than by worth.
 *
 * The window is a rolling count rather than a fixed bucket, because a bucket boundary
 * would let twelve events land in the last second of one minute and twelve more in the
 * first second of the next — technically within the band, audibly a wall.
 */

import type { CityEvent } from './events.js';
import type { ScoreConfig } from './config.js';

export interface GovernorOptions {
  readonly score: ScoreConfig;
  /** Local hour of day, for the daypart band. Injectable so tests need no clock. */
  readonly hourOf?: (epochMs: number) => number;
}

export class DensityGovernor {
  /** Epoch ms of each event promoted to the foreground, oldest first. */
  private promoted: number[] = [];
  private readonly hourOf: (epochMs: number) => number;

  constructor(private readonly options: GovernorOptions) {
    this.hourOf =
      options.hourOf ??
      ((epochMs) =>
        Number(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            hour12: false,
          }).format(new Date(epochMs)),
        ));
  }

  /** Foreground events allowed in the window ending now. */
  budget(now: number): number {
    const governor = this.options.score.governor;
    const hour = this.hourOf(now);
    const daytime = hour >= governor.day_from_hour && hour < governor.night_from_hour;
    const band = daytime ? governor.day : governor.night;
    // The ceiling is per minute; the window may be longer or shorter.
    return Math.round((band.max * governor.window_s) / 60);
  }

  /** How many foreground events are already in the window. */
  private inWindow(now: number): number {
    const cutoff = now - this.options.score.governor.window_s * 1000;
    this.promoted = this.promoted.filter((t) => t > cutoff);
    return this.promoted.length;
  }

  /**
   * Place each event in a tier.
   *
   * Highest salience first, so that when the budget runs out it is the least
   * significant events that become texture — the opposite of what a queue does.
   */
  admit(events: readonly CityEvent[], now: number): CityEvent[] {
    if (events.length === 0) return [];
    const budget = this.budget(now);
    let used = this.inWindow(now);

    const order = [...events].sort((a, b) => b.salience - a.salience);
    const tiers = new Map<string, 'voice' | 'texture'>();
    for (const event of order) {
      if (used < budget) {
        tiers.set(event.id, 'voice');
        this.promoted.push(event.t);
        used += 1;
      } else {
        tiers.set(event.id, 'texture');
      }
    }
    // Returned in the order they arrived, not in salience order: the caller's stream
    // is chronological and must stay that way.
    return events.map((event) => ({ ...event, tier: tiers.get(event.id) ?? 'texture' }));
  }

  /** Foreground events in the current window, for /healthz and the lab. */
  stats(now: number): { promotedInWindow: number; budget: number } {
    return { promotedInWindow: this.inWindow(now), budget: this.budget(now) };
  }
}
