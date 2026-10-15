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
import { Detector } from '../detector.js';
import type { CityEvent } from '../events.js';
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
  /** §6.5. Optional so tests can exercise detection without a density policy. */
  readonly governor?: { admit: (events: readonly CityEvent[], now: number) => CityEvent[] };
  readonly userAgent: string;
  readonly deps?: AircraftCollectorDeps;
  /** Called with each poll's observations. */
  readonly onObservations?: (observations: readonly Observation[], receivedAt: number) => void;
  /** Called with the events this poll produced. The event bus hooks in here (Phase 1). */
  readonly onEvents?: (events: readonly CityEvent[], receivedAt: number) => void;
}

export class AircraftCollector {
  /** Supervisor ticks between probes of the preferred source while on a fallback. */
  private static readonly PROBE_EVERY_TICKS = 4;

  readonly tracks: TrackStore;
  readonly detector: Detector;
  private eventsEmitted = 0;
  private readonly pollers = new Map<string, Poller>();
  private readonly order: string[] = [];
  private activeIndex = 0;
  private supervisor: NodeJS.Timeout | undefined;
  private supervisorTicks = 0;
  private probing = false;

  constructor(private readonly options: AircraftCollectorOptions) {
    const aircraft = options.sources.aircraft;
    this.tracks = new TrackStore({
      maxObservations: aircraft.track.max_observations,
      expireAfterMs: aircraft.track.expire_after_s * 1000,
    });
    this.detector = new Detector({ places: options.places, sources: options.sources });

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
    const { observations, rawForRecording, skipped, total, sourceNow } = parseAdsbResponse(
      body,
      receivedAt,
      sourceId,
    );
    if (skipped > 0) {
      console.warn(
        `[aircraft] ${sourceId}: ${String(skipped)} of ${String(total)} entries unparseable`,
      );
    }

    // Detect as each observation lands, because detection is about the transition
    // between consecutive observations — a departure is only visible as a crossing.
    const events: CityEvent[] = [];
    for (const observation of observations) {
      const history = this.tracks.add(observation);
      events.push(...this.detector.detect(history));
    }
    this.tracks.expire(receivedAt);
    // Keep detector state in step with the track store, or per-aircraft fired-event
    // state would accumulate for every aircraft ever seen.
    this.detector.retainOnly(this.tracks.icaos());
    this.eventsEmitted += events.length;
    if (events.length > 0) {
      // §6.5 places every event before it is recorded or published, so a recording
      // holds the piece as it was actually heard — which is what makes a replay a
      // replay rather than an approximation.
      const placed = this.options.governor?.admit(events, receivedAt) ?? events;
      this.options.recorder.recordEvents(placed, receivedAt);
      this.options.onEvents?.(placed, receivedAt);
      for (const event of placed) {
        console.log(
          `[event] ${event.type} ${event.tier} salience=${event.salience.toFixed(2)} ${event.caption}`,
        );
      }
    }

    // Both records are written: observations for the simulator and the lab (§3.5),
    // raw-minus-identity so §3.2's thresholds can be re-tuned without another 48
    // hours of waiting. Identity was already stripped by the parser (§3.7).
    this.options.recorder.recordObservations(observations, receivedAt);
    this.options.recorder.recordRaw(sourceId, rawForRecording, receivedAt, sourceNow);
    // Always record that a poll happened, even an empty one. Without this the
    // recordings cannot distinguish "empty sky at 4 a.m." from "we were not
    // polling" — a distinction the simulator (§3.5) and the P0-8 validation both
    // depend on.
    this.options.recorder.recordPoll(sourceId, receivedAt, observations.length, skipped, total);
    this.options.onObservations?.(observations, receivedAt);

    return { count: observations.length, skipped };
  }

  private get activeId(): string | undefined {
    return this.order[this.activeIndex];
  }

  /**
   * Fail over when the active source is down, and probe the preferred source so we
   * can come back.
   *
   * The probe is the point. A stopped poller never polls, so its health is frozen at
   * whatever it was when we left it — without an explicit probe, "drift back when the
   * preferred source recovers" is unreachable code, and one 30-second network blip at
   * hour 3 would pin the remaining 45 hours of a Phase 0 recording to the fallback,
   * silently changing the poll cadence mid-dataset.
   *
   * Probing costs one request per `PROBE_EVERY_TICKS` supervisor ticks, and only
   * while we are on a fallback.
   */
  private supervise(): void {
    this.supervisorTicks += 1;
    const activeId = this.activeId;
    if (activeId === undefined) return;

    // A healthier, more-preferred source has come back: return to it.
    const preferred = this.order.findIndex((id) => this.options.health.get(id)?.state === 'ok');
    if (preferred !== -1 && preferred < this.activeIndex) {
      this.switchTo(preferred, `${this.order[preferred] ?? '?'} recovered`);
      return;
    }

    if (this.options.health.get(activeId)?.state === 'down') {
      const next = (this.activeIndex + 1) % this.order.length;
      if (next !== this.activeIndex) {
        this.switchTo(next, `${activeId} is down`);
        return;
      }
    }

    // On a fallback and nothing better is known-good: take one probe at the
    // preferred source so its health can change.
    if (
      this.activeIndex > 0 &&
      !this.probing &&
      this.supervisorTicks % AircraftCollector.PROBE_EVERY_TICKS === 0
    ) {
      const preferredId = this.order[0];
      const poller = preferredId === undefined ? undefined : this.pollers.get(preferredId);
      if (poller !== undefined) {
        this.probing = true;
        void poller
          .pollOnce()
          .finally(() => {
            this.probing = false;
          })
          .catch(() => {
            /* pollOnce never throws; health carries the outcome. */
          });
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

    // Hold off briefly before the first request. Backoff state is in memory, so a
    // restart forgets it — and under `restart: unless-stopped` a crash loop would
    // otherwise poll a volunteer-run API as fast as it could restart.
    const config = this.options.sources.aircraft;
    const delay =
      config.startup_delay_ms +
      /* Startup jitter: request timing, not audible output. */
      // eslint-disable-next-line no-restricted-properties
      (this.options.deps?.random ?? Math.random)() * config.startup_jitter_ms;
    setTimeout(() => {
      this.pollers.get(first)?.start();
    }, delay);
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

  eventCount(): number {
    return this.eventsEmitted;
  }
}
