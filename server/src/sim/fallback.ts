/**
 * The simulator as a fallback. SPEC §3.5, §1.4 ("never silent"), §1.2 ("every sound
 * is true").
 *
 * Takes over only when every live source has been down for a while, and hands back
 * the moment one recovers. The delay is deliberate: swapping real traffic for a
 * replay because of a ten-second blip would be worse than a brief gap, since the
 * replay is by definition not what is happening outside.
 */

import type { SourcesConfig } from '../config.js';
import type { CityEvent } from '../events.js';
import type { HealthRegistry } from '../health.js';
import { buildModel, Simulator, type TrafficModel } from './simulator.js';

export interface FallbackOptions {
  readonly sources: SourcesConfig;
  readonly health: HealthRegistry;
  readonly seed: number;
  readonly now?: () => number;
}

export class SimulatorFallback {
  private simulator: Simulator | undefined;
  private model: TrafficModel | undefined;
  /** Logged once per outage, so a long outage does not fill the log. */
  private announced = false;
  private active = false;
  private lastWindowEnd = 0;
  private readonly now: () => number;

  constructor(private readonly options: FallbackOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * When a source last succeeded. Falls back to the earliest observed failure, and
   * then to now — so a server that has never seen a success does not immediately
   * believe the city has been gone forever.
   */
  private lastWorkingAt(now: number): number {
    const all = this.options.health.all();
    const successes = all
      .map((source) => source.lastSuccessAt)
      .filter((at): at is number => at !== null);
    if (successes.length > 0) return Math.max(...successes);
    const failures = all
      .map((source) => source.lastFailureAt)
      .filter((at): at is number => at !== null);
    return failures.length > 0 ? Math.min(...failures) : now;
  }

  /** Build the traffic model from recorded days. Without one, there is no fallback. */
  async loadModel(paths: readonly string[]): Promise<number> {
    this.model = await buildModel(paths);
    this.simulator = new Simulator({
      model: this.model,
      seed: this.options.seed,
      intensity: this.options.sources.simulator.intensity,
      replayCaptionSuffix: this.options.sources.simulator.caption_suffix,
    });
    return this.model.samples.length;
  }

  get isActive(): boolean {
    return this.active;
  }

  get hasModel(): boolean {
    return this.simulator !== undefined;
  }

  /**
   * Decide whether to take over, and produce events if so.
   *
   * Called on the same cadence as polling. Returns an empty list whenever a real
   * source is healthy — the real city always wins.
   */
  tick(): CityEvent[] {
    const config = this.options.sources.simulator;
    const now = this.now();

    if (this.options.health.anyHealthy(now)) {
      if (this.active) console.log('[sim] a live source recovered — handing back');
      this.active = false;
      this.announced = false;
      return [];
    }

    // How long since any source last worked, taken from health rather than from our
    // own tick timing. Measuring from the first tick after an outage made the delay
    // depend on when we happened to look, so a server started during an outage would
    // wait the full takeover delay all over again.
    const downForMs = now - this.lastWorkingAt(now);
    if (!config.enabled || this.simulator === undefined) return [];
    if (downForMs < config.takeover_after_s * 1000) return [];

    if (!this.active) {
      this.active = true;
      this.lastWindowEnd = now - config.window_s * 1000;
    }
    if (!this.announced) {
      this.announced = true;
      console.log(
        `[sim] every source down for ${String(Math.round(downForMs / 1000))}s — ` +
          'replaying recorded traffic, captioned as such',
      );
    }

    const windowMs = config.window_s * 1000;
    if (now - this.lastWindowEnd < windowMs) return [];
    this.lastWindowEnd = now;
    return this.simulator.generate(now, windowMs);
  }
}
