/**
 * The aircraft collection service: the source chain, the track store and the recorder,
 * wired together.
 *
 * SPEC §3.1 gives a fallback chain (adsb.lol → adsb.fi → simulator). The chain is
 * handled here rather than inside `Poller` so that each source keeps its own health,
 * its own interval and its own backoff — adsb.fi's documented 1 req/s is not
 * adsb.lol's "dynamic", and conflating them would mean respecting neither.
 *
 * Only one source is polled at a time. Polling both continuously would double the
 * load we place on two volunteer-run services to gain nothing: they carry the same
 * traffic.
 */

import type { PlacesConfig, SourcesConfig } from '../config.js';
import type { HealthRegistry } from '../health.js';
import type { Observation } from '../observation.js';
import { Poller, fetchJson } from '../poller.js';
import type { Recorder } from '../recorder.js';
import { TrackStore } from '../tracks.js';
import { parseAdsbResponse } from './adsb.js';

export interface AircraftCollectorDeps {
  readonly fetchJson?: typeof fetchJson;
  readonly now?: () => number;
  readonly random?: () => number;
}

export interface AircraftCollectorOptions {
  readonly sources: SourcesConfig;
  readonly places: PlacesConfig;
  readonly health: HealthRegistry;
  readonly recorder: Recorder;
  readonly userAgent: string;
  readonly deps?: AircraftCollectorDeps;
  /** Called with each poll's observations — the detector hooks in here (P0-5). */
  readonly onObservations?: (observations: readonly Observation[], receivedAt: number) => void;
}

export class AircraftCollector {
  readonly tracks: TrackStore;
  private readonly pollers = new Map<string, Poller>();
  private readonly order: string[] = [];
  private activeIndex = 0;
  private supervisor: NodeJS.Timeout | undefined;
  private readonly now: () => number;

  constructor(private readonly options: AircraftCollectorOptions) {
    const aircraft = options.sources.aircraft;
    this.now = options.deps?.now ?? Date.now;
    this.tracks = new TrackStore({
      maxObservations: aircraft.track.max_observations,
      expireAfterMs: aircraft.track.expire_after_s * 1000,
    });

    for (const source of aircraft.sources) {
      if (!source.enabled) continue;
      this.order.push(source.id);
      options.health.register(source.id);
      this.pollers.set(
        source.id,
        new Poller(
          {
            id: source.id,
            intervalMs: source.interval_s * 1000,
            jitterMs: source.jitter_s * 1000,
            timeoutMs: source.timeout_ms,
            backoff: {
              initialMs: aircraft.backoff.initial_ms,
              multiplier: aircraft.backoff.multiplier,
              maxMs: aircraft.backoff.max_ms,
            },
            userAgent: options.userAgent,
          },
          () => this.buildUrl(source.url_template),
          (body, receivedAt) => this.handlePoll(body, receivedAt, source.id),
          options.health,
          {
            fetchJson: options.deps?.fetchJson ?? fetchJson,
            now: options.deps?.now ?? Date.now,
            /* Polling jitter, not audible or visible output — see poller.ts. */
            // eslint-disable-next-line no-restricted-properties
            random: options.deps?.random ?? Math.random,
          },
        ),
      );
    }
  }

  private buildUrl(template: string): string {
    const { origin } = this.options.places;
    return template
      .replace('{lat}', String(origin.lat))
      .replace('{lon}', String(origin.lon))
      .replace('{radius_nm}', String(this.options.sources.aircraft.radius_nm));
  }

  private handlePoll(
    body: unknown,
    receivedAt: number,
    sourceId: string,
  ): { count: number; skipped: number } {
    const { observations, rawForRecording, skipped } = parseAdsbResponse(
      body,
      receivedAt,
      sourceId,
    );

    for (const observation of observations) {
      this.tracks.add(observation);
    }
    this.tracks.expire(receivedAt);

    // Both records are written: observations for the simulator and the lab (§3.5),
    // raw-minus-identity so §3.2's thresholds can be re-tuned without another 48
    // hours of waiting. Identity was already stripped by the parser (§3.7).
    this.options.recorder.recordObservations(observations, receivedAt);
    this.options.recorder.recordRaw(sourceId, rawForRecording, receivedAt);
    this.options.onObservations?.(observations, receivedAt);

    return { count: observations.length, skipped };
  }

  private get activeId(): string | undefined {
    return this.order[this.activeIndex];
  }

  /**
   * Fail over when the active source is down, and drift back when a better one
   * recovers. Preference order is the config order, so adsb.lol is used whenever it
   * is healthy even if adsb.fi is currently carrying us.
   */
  private supervise(): void {
    const activeId = this.activeId;
    if (activeId === undefined) return;

    const preferred = this.order.findIndex((id) => this.options.health.get(id)?.state === 'ok');
    if (preferred !== -1 && preferred < this.activeIndex) {
      this.switchTo(preferred, `${this.order[preferred] ?? '?'} recovered`);
      return;
    }

    if (this.options.health.get(activeId)?.state === 'down') {
      const next = (this.activeIndex + 1) % this.order.length;
      if (next !== this.activeIndex) {
        this.switchTo(next, `${activeId} is down`);
      }
    }
  }

  private switchTo(index: number, reason: string): void {
    const from = this.activeId;
    if (from !== undefined) this.pollers.get(from)?.stop();
    this.activeIndex = index;
    const to = this.activeId;
    if (to !== undefined) {
      console.log(`[aircraft] switching ${from ?? 'none'} → ${to} (${reason})`);
      this.pollers.get(to)?.start();
    }
  }

  start(): void {
    const first = this.activeId;
    if (first === undefined) throw new Error('no enabled aircraft source');
    this.pollers.get(first)?.start();
    // Checked on a slow cadence: failover is not urgent, and §3.5's simulator is the
    // labelled last resort if the whole chain is down.
    this.supervisor = setInterval(() => {
      this.supervise();
    }, 15_000);
  }

  stop(): void {
    if (this.supervisor !== undefined) clearInterval(this.supervisor);
    this.supervisor = undefined;
    for (const poller of this.pollers.values()) poller.stop();
  }

  /** Exposed for tests and the admin page (§9.5). */
  currentSourceId(): string | undefined {
    return this.activeId;
  }

  lastExpiryCheck(): number {
    return this.now();
  }
}
