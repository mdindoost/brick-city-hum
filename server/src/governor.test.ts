import { describe, expect, it } from 'vitest';
import { DensityGovernor } from './governor.js';
import { loadScore } from './config.js';
import type { CityEvent } from './events.js';

const score = loadScore();
const T0 = 1_760_458_800_000;

function event(id: string, salience: number, t = T0): CityEvent {
  return {
    id,
    t,
    type: 'sky',
    source: 'test',
    geo: { lat: 40.74, lon: -74.17, alt_ft: 3000 },
    rel: { bearing_deg: 90, distance_km: 10 },
    attrs: {
      callsign: null,
      operator: null,
      category: null,
      type_code: null,
      vrate_fpm: null,
      track_deg: null,
      heavy: false,
      described_as: 'a plane',
    },
    salience,
    tier: 'voice',
    caption: 'test',
    sim: false,
    scheduled: false,
  };
}

/** Noon in Newark, so the daytime band applies. */
function governor(hour = 12): DensityGovernor {
  return new DensityGovernor({ score, hourOf: () => hour });
}

describe('DensityGovernor', () => {
  it('promotes the most salient and demotes the rest, rather than dropping any', () => {
    const g = governor();
    const budget = g.budget(T0);
    const events = Array.from({ length: budget + 5 }, (_, i) => event(`e${String(i)}`, i / 100));
    const placed = g.admit(events, T0);

    expect(placed).toHaveLength(events.length); // nothing is lost
    const voices = placed.filter((e) => e.tier === 'voice');
    expect(voices).toHaveLength(budget);
    // The survivors are the loudest-ranked, not the first to arrive.
    const lowest = Math.min(...voices.map((e) => e.salience));
    const demoted = placed.filter((e) => e.tier === 'texture');
    expect(Math.max(...demoted.map((e) => e.salience))).toBeLessThanOrEqual(lowest);
  });

  it('keeps the chronological order it was given', () => {
    const g = governor();
    const events = [event('a', 0.1), event('b', 0.9), event('c', 0.5)];
    expect(g.admit(events, T0).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('spends the window budget across several batches, not per batch', () => {
    // The defect a per-batch limit would have: twelve events in one second and twelve
    // more a second later, each batch "within the band" and the minute a wall.
    const g = governor();
    const budget = g.budget(T0);
    let promoted = 0;
    for (let batch = 0; batch < 5; batch += 1) {
      const events = Array.from({ length: budget }, (_, i) =>
        event(`b${String(batch)}_${String(i)}`, 0.5, T0 + batch * 1000),
      );
      promoted += g.admit(events, T0 + batch * 1000).filter((e) => e.tier === 'voice').length;
    }
    expect(promoted).toBe(budget);
  });

  it('rolls the window forward, so a quiet minute restores the budget', () => {
    const g = governor();
    const budget = g.budget(T0);
    const fill = Array.from({ length: budget }, (_, i) => event(`f${String(i)}`, 0.5));
    expect(g.admit(fill, T0).filter((e) => e.tier === 'voice')).toHaveLength(budget);
    expect(g.admit([event('next', 0.9)], T0 + 1000)[0]!.tier).toBe('texture');

    const later = T0 + (score.governor.window_s + 1) * 1000;
    expect(g.admit([event('after', 0.9, later)], later)[0]!.tier).toBe('voice');
  });

  it('is stricter at night than in the day', () => {
    expect(governor(3).budget(T0)).toBeLessThan(governor(12).budget(T0));
  });
});
