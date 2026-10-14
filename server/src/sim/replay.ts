/**
 * Replay a recording. SPEC §3.5.
 *
 * Two jobs, and they are not the same job:
 *
 *  - **Development and tests**: replay a recorded day at any speed, so the detector
 *    and the audio engine can be exercised against real traffic without waiting for
 *    real traffic, and without touching a volunteer-run API.
 *  - **The labelled last resort** (§3.5): when every live source is down, the radio
 *    keeps playing rather than falling silent — but honestly. Every event it emits
 *    carries `sim: true` and says "replay" in its caption, because §1.2 is that every
 *    sound is true, and a listener must never be told a plane just took off when it
 *    did not.
 */

import { readRecording } from '../recorder.js';
import { eventSchema, type CityEvent } from '../events.js';

export interface ReplayOptions {
  /** `*-event.ndjson.gz` to replay. */
  readonly path: string;
  /** 1 = real time. Higher is faster, for tests and offline renders. */
  readonly speed?: number;
  /** Start again at the beginning when the recording runs out. */
  readonly loop?: boolean;
  /** Suffix marking an event as a replay. From config in the live path. */
  readonly replayCaptionSuffix?: string;
}

interface RecordedEventLine {
  t: number;
  events: unknown[];
}

/**
 * Mark an event as a replay — honestly, and in a way that survives serialisation.
 *
 * Both halves matter. `sim: true` is what the governor, the recorder and any future
 * analysis key on; the caption is what the listener actually reads. Setting only the
 * flag would leave the ticker claiming a live departure.
 */
export function markAsReplay(event: CityEvent, suffix: string): CityEvent {
  return {
    ...event,
    sim: true,
    caption: event.caption.endsWith(suffix) ? event.caption : `${event.caption} ${suffix}`,
  };
}

export class Replayer {
  private events: CityEvent[] = [];
  private index = 0;
  private loaded = false;

  constructor(private readonly options: ReplayOptions) {}

  private get suffix(): string {
    return this.options.replayCaptionSuffix ?? '(replay)';
  }

  /**
   * Load the recording.
   *
   * Events that fail validation are skipped rather than thrown on: a recording is
   * historical data we cannot go back and fix, and one bad line must not make a
   * whole day unusable — least of all when this is running because everything else
   * already failed.
   */
  async load(): Promise<number> {
    const lines = (await readRecording(this.options.path)) as RecordedEventLine[];
    const events: CityEvent[] = [];
    for (const line of lines) {
      for (const raw of line.events ?? []) {
        const parsed = eventSchema.safeParse(raw);
        if (parsed.success) events.push(parsed.data);
      }
    }
    events.sort((a, b) => a.t - b.t);
    this.events = events;
    this.loaded = true;
    this.index = 0;
    return events.length;
  }

  get size(): number {
    return this.events.length;
  }

  /** Wall-clock span of the recording, in ms. */
  get spanMs(): number {
    const first = this.events[0];
    const last = this.events[this.events.length - 1];
    if (first === undefined || last === undefined) return 0;
    return last.t - first.t;
  }

  /**
   * Events whose replay time falls in `(sinceMs, nowMs]`, relative to the start of
   * the replay. Pull-based rather than timer-based so the caller owns the clock —
   * which is what lets the lab render faster than real time and reproduce exactly.
   */
  due(sinceMs: number, nowMs: number): CityEvent[] {
    if (!this.loaded) throw new Error('Replayer.load() must be awaited before due()');
    const first = this.events[0];
    if (first === undefined) return [];

    const speed = this.options.speed ?? 1;
    const span = this.spanMs;
    const out: CityEvent[] = [];

    for (;;) {
      const event = this.events[this.index];
      if (event === undefined) {
        if (this.options.loop !== true || span === 0) break;
        // Loop: start again, offsetting the timestamps so the stream stays monotonic
        // rather than jumping backwards.
        this.index = 0;
        continue;
      }
      const offsetMs = (event.t - first.t) / speed;
      if (offsetMs > nowMs) break;
      if (offsetMs > sinceMs) {
        out.push(markAsReplay({ ...event, t: Date.now() }, this.suffix));
      }
      this.index += 1;
      if (this.options.loop === true && this.index >= this.events.length) break;
    }
    return out;
  }

  reset(): void {
    this.index = 0;
  }
}
