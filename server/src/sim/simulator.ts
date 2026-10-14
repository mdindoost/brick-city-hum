/**
 * The city simulator. SPEC §3.5.
 *
 * Generates plausible synthetic events from the *statistics* of recorded days, rather
 * than replaying one. That matters for the case it exists for: if every source is
 * down for an hour, a looped replay becomes audibly a loop — and §6.7 names
 * repetition as the biggest risk to the whole piece.
 *
 * Honest by construction: everything it emits carries `sim: true` and says "replay"
 * in its caption (§3.5), and the model is built only from events that really
 * happened. §1.2 says nothing is invented; a statistical redistribution of real
 * traffic is the closest a fallback can get to that, and it is labelled as not live.
 */

import { mulberry32 } from '../../../shared/random.js';
import { eventSchema, type CityEvent, type EventType } from '../events.js';
import { readRecording } from '../recorder.js';
import { markAsReplay } from './replay.js';

export interface TrafficModel {
  /** Mean events per minute, per hour of the local day (24 entries). */
  readonly ratePerMinuteByHour: readonly number[];
  /** Observed share of each event type. */
  readonly typeWeights: Readonly<Record<string, number>>;
  /** Pooled sample of real events, drawn from to build synthetic ones. */
  readonly samples: readonly CityEvent[];
}

/** Build a traffic model from one or more recorded event files. */
export async function buildModel(paths: readonly string[]): Promise<TrafficModel> {
  const events: CityEvent[] = [];
  for (const path of paths) {
    const lines = (await readRecording(path)) as { events?: unknown[] }[];
    for (const line of lines) {
      for (const raw of line.events ?? []) {
        const parsed = eventSchema.safeParse(raw);
        if (parsed.success) events.push(parsed.data);
      }
    }
  }

  const byHour = new Array<number>(24).fill(0);
  const minutesSeen = new Array<number>(24).fill(0);
  const seenMinutes = new Set<string>();
  const typeCounts: Record<string, number> = {};

  for (const event of events) {
    const date = new Date(event.t);
    const hour = date.getUTCHours();
    byHour[hour] = (byHour[hour] ?? 0) + 1;
    typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1;
    const key = `${String(hour)}:${String(date.getUTCMinutes())}`;
    if (!seenMinutes.has(key)) {
      seenMinutes.add(key);
      minutesSeen[hour] = (minutesSeen[hour] ?? 0) + 1;
    }
  }

  const total = events.length || 1;
  return {
    // Rate per minute, from minutes actually observed — not from a 60-minute
    // assumption. A recording covering ten minutes of an hour must not imply the
    // city was quiet for the other fifty.
    ratePerMinuteByHour: byHour.map((count, hour) => {
      const minutes = minutesSeen[hour] ?? 0;
      return minutes === 0 ? 0 : count / minutes;
    }),
    typeWeights: Object.fromEntries(
      Object.entries(typeCounts).map(([type, count]) => [type, count / total]),
    ),
    samples: events,
  };
}

export interface SimulatorOptions {
  readonly model: TrafficModel;
  readonly seed: number;
  readonly replayCaptionSuffix?: string;
  /** Overall rate multiplier, for tests and for a deliberately quieter fallback. */
  readonly intensity?: number;
}

export class Simulator {
  private readonly random: () => number;
  private counter = 0;

  constructor(private readonly options: SimulatorOptions) {
    this.random = mulberry32(options.seed);
  }

  private get suffix(): string {
    return this.options.replayCaptionSuffix ?? '(replay)';
  }

  /** Expected events in a window, given the hour of day. */
  expectedCount(hour: number, windowMs: number): number {
    const rate = this.options.model.ratePerMinuteByHour[hour] ?? 0;
    return rate * (windowMs / 60_000) * (this.options.intensity ?? 1);
  }

  /**
   * Generate the events for a window.
   *
   * Deterministic for a given seed and call sequence, so a simulated day can be
   * rendered twice and compared (§7.3) exactly as a real recording can.
   */
  generate(now: number, windowMs: number): CityEvent[] {
    const { samples } = this.options.model;
    if (samples.length === 0) return [];

    const hour = new Date(now).getUTCHours();
    const expected = this.expectedCount(hour, windowMs);
    // Fractional expectations become a probability rather than being floored away:
    // at 3 a.m. the rate is well under one per window, and flooring would mean total
    // silence instead of an occasional aircraft.
    const whole = Math.floor(expected);
    const count = whole + (this.random() < expected - whole ? 1 : 0);

    const out: CityEvent[] = [];
    for (let i = 0; i < count; i += 1) {
      const source = samples[Math.floor(this.random() * samples.length)];
      if (source === undefined) continue;
      this.counter += 1;
      out.push(
        markAsReplay(
          {
            ...source,
            id: `sim_${String(this.options.seed)}_${String(this.counter)}`,
            t: now + Math.floor(this.random() * windowMs),
            source: 'simulator',
          },
          this.suffix,
        ),
      );
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /** The type mix the model saw, for the admin page and lab reports. */
  typeMix(): Readonly<Record<string, number>> {
    return this.options.model.typeWeights;
  }

  /** Whether a type was ever observed — the simulator invents no new kinds of event. */
  knows(type: EventType): boolean {
    return (this.options.model.typeWeights[type] ?? 0) > 0;
  }
}
