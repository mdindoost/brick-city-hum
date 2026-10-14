/**
 * Polite polling: jitter, timeout, exponential backoff, health reporting.
 *
 * SPEC §9.1 requires all of these per collector. They are not optional niceties —
 * adsb.lol and adsb.fi are free services run by volunteers, they return **no
 * rate-limit headers at all** (verified 2026-10-14), so we cannot adapt to their
 * load and must simply be conservative. A tight retry loop here would get us
 * blocked, and SPEC §14's whole fallback strategy assumes we are a welcome guest.
 */

import type { HealthRegistry } from './health.js';

export interface BackoffOptions {
  readonly initialMs: number;
  readonly multiplier: number;
  readonly maxMs: number;
}

export interface PollerOptions {
  readonly id: string;
  readonly intervalMs: number;
  /** Random spread added to each interval, so we never align with another client. */
  readonly jitterMs: number;
  readonly timeoutMs: number;
  readonly backoff: BackoffOptions;
  readonly userAgent: string;
}

/**
 * Delay before the next attempt after `consecutiveFailures` failures.
 *
 * Exported and pure so the backoff curve can be tested without waiting for it —
 * testing this by actually sleeping would make the suite take minutes.
 */
export function backoffDelayMs(options: BackoffOptions, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const raw = options.initialMs * options.multiplier ** (consecutiveFailures - 1);
  return Math.min(raw, options.maxMs);
}

/** True for statuses where retrying later is the right move (SPEC §9.1). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

export class RetryableHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${String(status)} from ${url}`);
    this.name = 'RetryableHttpError';
  }
}

export class PermanentHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${String(status)} from ${url}`);
    this.name = 'PermanentHttpError';
  }
}

/**
 * Fetch JSON with a timeout and an honest User-Agent.
 *
 * Distinguishes retryable from permanent failures, because they call for opposite
 * behaviour: a 429 means wait, a 404 means the endpoint moved and waiting will never
 * help — that is a failover, and silently retrying it forever would hide the fact.
 */
export async function fetchJson(
  url: string,
  options: { timeoutMs: number; userAgent: string },
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'user-agent': options.userAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (!response.ok) {
    throw isRetryableStatus(response.status)
      ? new RetryableHttpError(response.status, url)
      : new PermanentHttpError(response.status, url);
  }

  return response.json();
}

type PollHandler = (body: unknown, receivedAt: number) => { count: number; skipped: number };

/**
 * A single source, polled on a loop until stopped.
 *
 * The loop is sequential by construction: the next delay is computed only after the
 * current attempt settles. A `setInterval` would let a slow response overlap the next
 * request and quietly double our request rate against a service that has given us no
 * way to see we are doing it.
 */
export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private consecutiveFailures = 0;
  /**
   * True while a request is outstanding.
   *
   * This is what keeps exactly one loop running across a stop/start. A `stop()`
   * during a request cannot cancel the request, so if `start()` then scheduled a
   * fresh attempt we would have two in flight and double our request rate against a
   * volunteer service. Instead `start()` stands down and the outstanding request's
   * own continuation carries the loop forward.
   */
  private inFlight = false;

  constructor(
    private readonly options: PollerOptions,
    private readonly url: () => string,
    private readonly handle: PollHandler,
    private readonly health: HealthRegistry,
    /** Injectable so tests need neither the network nor real time. */
    private readonly deps: {
      fetchJson: typeof fetchJson;
      now: () => number;
      random: () => number;
      /* Request jitter is not audible or visible output, so SPEC §5's seeded-PRNG
         rule does not apply. It must be genuinely unpredictable to spread load,
         which a shared seed would defeat. */
      // eslint-disable-next-line no-restricted-properties
    } = { fetchJson, now: Date.now, random: Math.random },
  ) {}

  /**
   * Begin polling. If this poller already has failures behind it, the first attempt
   * waits out its backoff rather than firing immediately — otherwise every failover
   * flap injects an un-backed-off request, which is exactly wrong when the reason we
   * failed over was a 429.
   */
  start(): void {
    this.stopped = false;
    // A request is already outstanding (we were stopped and restarted mid-flight).
    // Its continuation will reschedule; scheduling here too would run two loops.
    if (this.inFlight) return;
    this.scheduleNext(backoffDelayMs(this.options.backoff, this.consecutiveFailures));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * One attempt. Exposed for tests, and for the collector's probe of a stopped
   * preferred source.
   *
   * Skips if a request is already outstanding, so a probe can never overlap the loop.
   */
  async pollOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.attempt();
    } finally {
      this.inFlight = false;
    }
  }

  private async attempt(): Promise<void> {
    const url = this.url();
    try {
      const body = await this.deps.fetchJson(url, {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
      });
      const receivedAt = this.deps.now();
      const { count, skipped } = this.handle(body, receivedAt);
      this.consecutiveFailures = 0;
      this.health.recordSuccess(this.options.id, receivedAt, count, skipped);
    } catch (error) {
      this.consecutiveFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.health.recordFailure(this.options.id, this.deps.now(), message);
    }
  }

  private nextDelayMs(): number {
    if (this.consecutiveFailures > 0) {
      return backoffDelayMs(this.options.backoff, this.consecutiveFailures);
    }
    return this.options.intervalMs + this.deps.random() * this.options.jitterMs;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    // Only ever one pending timer.
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => {
        // `stopped` is re-read here, not captured: a stop during the request must
        // end the loop, and a stop-then-start must leave exactly this one loop.
        this.scheduleNext(this.nextDelayMs());
      });
    }, delayMs);
  }
}
