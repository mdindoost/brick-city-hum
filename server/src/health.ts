/**
 * Source health. SPEC §3.5: every collector reports `ok`, `degraded` or `down` plus
 * its last success, to `/healthz` and the admin page (§9.5).
 *
 * Why this is more than bookkeeping: SPEC §3.5 makes the simulator the labelled last
 * resort, and the only way to know we have fallen back to it is to know a source is
 * down. A collector that fails silently is indistinguishable from a quiet city.
 */

/**
 * SPEC §3.5 names `ok`, `degraded` and `down`. `idle` is added here for a standby
 * source that has never been polled — a fallback waiting its turn is not "down", and
 * reporting it as down on /healthz would page a human about a healthy system.
 * Proposed as a §3.5 addition; see docs/decisions.md.
 */
export type HealthState = 'ok' | 'degraded' | 'down' | 'idle';

export interface SourceHealth {
  readonly id: string;
  readonly state: HealthState;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  /** Observations returned by the most recent successful poll. */
  readonly lastCount: number | null;
  /** Entries the parser could not read on the last successful poll. */
  readonly lastSkipped: number | null;
}

export class HealthRegistry {
  private readonly sources = new Map<string, SourceHealth>();

  constructor(private readonly failuresBeforeDegraded: number) {}

  register(id: string): void {
    this.sources.set(id, {
      id,
      state: 'idle',
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastError: null,
      lastCount: null,
      lastSkipped: null,
    });
  }

  recordSuccess(id: string, at: number, count: number, skipped: number): void {
    const existing = this.sources.get(id);
    this.sources.set(id, {
      id,
      state: 'ok',
      lastSuccessAt: at,
      lastFailureAt: existing?.lastFailureAt ?? null,
      consecutiveFailures: 0,
      lastError: null,
      lastCount: count,
      lastSkipped: skipped,
    });
  }

  recordFailure(id: string, at: number, error: string): void {
    const existing = this.sources.get(id);
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
    this.sources.set(id, {
      id,
      // One failure is weather; several in a row is a problem. Only after the
      // configured threshold do we call a source down and let the chain fail over.
      state: consecutiveFailures >= this.failuresBeforeDegraded ? 'down' : 'degraded',
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastFailureAt: at,
      consecutiveFailures,
      lastError: error,
      lastCount: existing?.lastCount ?? null,
      lastSkipped: existing?.lastSkipped ?? null,
    });
  }

  get(id: string): SourceHealth | undefined {
    return this.sources.get(id);
  }

  all(): SourceHealth[] {
    return [...this.sources.values()];
  }

  /** True when at least one source is currently healthy. */
  anyHealthy(): boolean {
    return this.all().some((source) => source.state === 'ok');
  }
}
