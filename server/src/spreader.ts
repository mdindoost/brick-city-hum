/**
 * The release queue: the city arrives in clumps, and the piece is not allowed to.
 * SPEC §1.4, §6.3, §6.5.
 *
 * **The measurement this file exists for.** Six minutes of real traffic, 684 events —
 * about 114 a minute, which is the rate two listening rounds asked for. They arrive
 * in **25 batches**: one poll of the ADS-B feed is one batch, every event in it shares
 * one `play_at`, and the median gap between batches is 11.3 seconds. One batch held
 * 161 events. So what a listener actually heard was sixteen notes inside a single
 * tenth of a second, then eleven seconds of drone, twenty-five times over.
 *
 * That is both halves of §1.4 at once — chaotic, then silent — and it is the better
 * explanation of round 2's verdict ("far too few events") than the one acted on at
 * the time. The events were there. They were all at the same instant.
 *
 * **Why the server and not the client.** §6.5: the governor is authoritative so that
 * every listener hears the same piece. A client-side spread would give two browsers
 * two different rhythms, which breaks the one promise this project makes.
 *
 * **Why this is honest.** §1.3 asks that every note trace to a real event "in the last
 * seconds or minutes", which is exactly the delay this introduces — and `max_delay_s`
 * is the limit past which an event is released whatever the queue looks like, so
 * nothing is ever held back long enough to stop being true. Captions are unchanged.
 *
 * It holds events; it never invents, reorders by worth alone, or discards them.
 */

import type { ScoreConfig } from './config.js';

/**
 * Anything with a salience can be spread.
 *
 * Generic so that the listening lab can run recorded events through the very same
 * queue the server uses (`lab/render.ts`). A render that spread events by its own
 * arithmetic would be measuring a piece no listener will ever hear, and this change
 * exists to be A/B'd.
 */
export interface Spreadable {
  readonly salience: number;
}

interface Queued<T> {
  readonly event: T;
  /** When it arrived, so nothing can be held past `max_delay_s`. */
  readonly at: number;
  /** When it is meant to play: its own slot in the window (see `offer`). */
  readonly due: number;
}

export interface SpreaderOptions {
  readonly score: ScoreConfig;
}

export class Spreader<T extends Spreadable> {
  private queue: Queued<T>[] = [];

  constructor(private readonly options: SpreaderOptions) {}

  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Take a batch and give every event in it a slot in the window.
   *
   * The slots are even: event *i* of *n* is due at `now + i/n × window_s`. Deciding
   * the whole schedule here, rather than metering the queue tick by tick, is what
   * makes the release rate constant — a rate computed from the queue's current length
   * decays with it, and a sixteen-note batch takes minutes to finish on a curve that
   * never quite reaches zero. This empties in exactly one window.
   *
   * Sorted by salience, descending, so the strongest event in a batch leads it and
   * the texture follows: dealing them out in arrival order would put a wash of ring
   * crossings first and the departure that caused them eight seconds later.
   *
   * Batches overlap freely. Two polls inside one window interleave, which is what a
   * busy minute should sound like.
   */
  offer(events: readonly T[], now: number): void {
    const window = this.options.score.spread.window_s * 1000;
    const ordered = [...events].sort((a, b) => b.salience - a.salience);
    for (const [index, event] of ordered.entries()) {
      this.queue.push({ event, at: now, due: now + (index / ordered.length) * window });
    }
    // By due time, so overlapping batches interleave rather than queueing behind
    // each other.
    this.queue.sort((a, b) => a.due - b.due);
  }

  /**
   * The events to play at this instant: everything whose slot has come.
   *
   * Two rules sit on top of the schedule. The **per-tick cap** is what stops a
   * 161-event batch from becoming a chord again — three notes inside 250 ms is a
   * gesture, sixteen is a wash. And **nothing is held past `max_delay_s`**, cap or no
   * cap: an event that is no longer about the last few minutes is no longer true
   * (§1.3), and late and audible beats silently discarded.
   */
  drain(now: number): T[] {
    if (this.queue.length === 0) return [];
    const spread = this.options.score.spread;

    let count = 0;
    while (count < this.queue.length && (this.queue[count]?.due ?? Infinity) <= now) count += 1;
    const stale = this.queue.filter((item) => now - item.at >= spread.max_delay_s * 1000).length;
    count = Math.max(Math.min(count, spread.max_per_tick), stale);

    if (count === 0) return [];
    return this.queue.splice(0, count).map((item) => item.event);
  }
}
