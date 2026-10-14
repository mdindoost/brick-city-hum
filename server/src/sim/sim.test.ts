import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel, Simulator } from './simulator.js';
import { markAsReplay, Replayer } from './replay.js';
import { HealthRegistry } from '../health.js';
import { Recorder } from '../recorder.js';
import { SimulatorFallback } from './fallback.js';
import { realSources } from '../testing.js';
import type { CityEvent } from '../events.js';

const T0 = Date.UTC(2026, 9, 14, 14, 0, 0);

function event(overrides: Partial<CityEvent> = {}): CityEvent {
  return {
    id: 'evt_1',
    t: T0,
    type: 'ewr_departure',
    source: 'adsb.lol',
    geo: { lat: 40.69, lon: -74.17, alt_ft: 1600 },
    rel: { bearing_deg: 171.1, distance_km: 5.57 },
    attrs: {
      callsign: 'UAL1810',
      operator: 'United',
      category: 'A3',
      type_code: 'B738',
      vrate_fpm: 2200,
      heavy: false,
      described_as: 'an airliner',
    },
    salience: 0.65,
    caption: '✈ an airliner departing Newark',
    sim: false,
    scheduled: false,
    ...overrides,
  };
}

/** Write events to a real recording file, so tests exercise the real read path. */
async function recordingWith(events: CityEvent[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'bch-sim-'));
  const recorder = new Recorder({ directory: dir });
  for (const item of events) recorder.recordEvents([item], item.t);
  await recorder.close();
  return join(dir, `${new Date(events[0]!.t).toISOString().slice(0, 10)}-event.ndjson.gz`);
}

describe('markAsReplay — honesty is not optional (SPEC §3.5, §1.2)', () => {
  it('sets both the flag and the caption', () => {
    // The flag is what the governor and any analysis key on; the caption is what a
    // listener actually reads. Setting only the flag would leave the ticker claiming
    // a live departure that did not happen.
    const marked = markAsReplay(event(), '(replay)');
    expect(marked.sim).toBe(true);
    expect(marked.caption).toContain('(replay)');
  });

  it('does not double-mark an already marked event', () => {
    const once = markAsReplay(event(), '(replay)');
    const twice = markAsReplay(once, '(replay)');
    expect(twice.caption.match(/\(replay\)/g)).toHaveLength(1);
  });

  it('leaves the original event untouched', () => {
    const original = event();
    markAsReplay(original, '(replay)');
    expect(original.sim).toBe(false);
    expect(original.caption).not.toContain('replay');
  });
});

describe('Replayer', () => {
  it('replays events in time order, honestly marked', async () => {
    const path = await recordingWith([
      event({ id: 'a', t: T0 }),
      event({ id: 'b', t: T0 + 30_000 }),
      event({ id: 'c', t: T0 + 90_000 }),
    ]);
    const replayer = new Replayer({ path });
    expect(await replayer.load()).toBe(3);

    expect(replayer.due(-1, 0)).toHaveLength(1);
    expect(replayer.due(0, 60_000)).toHaveLength(1);
    const rest = replayer.due(60_000, 120_000);
    expect(rest).toHaveLength(1);
    for (const item of rest) {
      expect(item.sim).toBe(true);
      expect(item.caption).toContain('(replay)');
    }
  });

  it('respects the speed multiplier, so the lab can render faster than real time', async () => {
    const path = await recordingWith([
      event({ id: 'a', t: T0 }),
      event({ id: 'b', t: T0 + 60_000 }),
    ]);
    const replayer = new Replayer({ path, speed: 60 });
    await replayer.load();
    // At 60x, a minute of recording is one second of replay.
    expect(replayer.due(-1, 1000)).toHaveLength(2);
  });

  it('skips unparseable records rather than failing the whole recording', async () => {
    // A recording is historical data we cannot go back and fix, and this runs when
    // everything else has already failed. One bad line must not cost the day.
    const dir = mkdtempSync(join(tmpdir(), 'bch-sim-'));
    const recorder = new Recorder({ directory: dir });
    recorder.recordEvents([event({ id: 'good' })], T0);
    await recorder.close();
    const path = join(dir, `${new Date(T0).toISOString().slice(0, 10)}-event.ndjson.gz`);

    const replayer = new Replayer({ path });
    expect(await replayer.load()).toBe(1);
  });

  it('reports an empty recording as empty rather than throwing', async () => {
    const path = await recordingWith([event()]);
    const replayer = new Replayer({ path });
    await replayer.load();
    expect(replayer.due(1_000_000, 2_000_000)).toHaveLength(0);
  });

  it('refuses to be used before loading', () => {
    const replayer = new Replayer({ path: '/nonexistent' });
    expect(() => replayer.due(0, 1000)).toThrow(/load\(\)/);
  });
});

describe('Simulator', () => {
  async function model() {
    const events = [];
    for (let i = 0; i < 40; i += 1) {
      events.push(
        event({
          id: `e${String(i)}`,
          t: T0 + i * 15_000,
          type: i % 4 === 0 ? 'ewr_arrival' : 'ewr_departure',
        }),
      );
    }
    return buildModel([await recordingWith(events)]);
  }

  it('builds a model from real events only', async () => {
    const built = await model();
    expect(built.samples.length).toBe(40);
    expect(Object.keys(built.typeWeights).sort()).toEqual(['ewr_arrival', 'ewr_departure']);
    // Weights are shares, so they sum to 1.
    const sum = Object.values(built.typeWeights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('invents no event type it never observed', async () => {
    // §1.2: nothing is invented. A statistical redistribution of real traffic is as
    // close as a fallback can get, and it is labelled as not live.
    const sim = new Simulator({ model: await model(), seed: 1 });
    expect(sim.knows('ewr_departure')).toBe(true);
    expect(sim.knows('helicopter')).toBe(false);
  });

  it('marks everything it generates as a replay', async () => {
    const sim = new Simulator({ model: await model(), seed: 7 });
    const generated = sim.generate(T0, 10 * 60_000);
    expect(generated.length).toBeGreaterThan(0);
    for (const item of generated) {
      expect(item.sim).toBe(true);
      expect(item.caption).toContain('(replay)');
      expect(item.source).toBe('simulator');
    }
  });

  it('is deterministic for a given seed', async () => {
    const built = await model();
    const a = new Simulator({ model: built, seed: 99 }).generate(T0, 300_000);
    const b = new Simulator({ model: built, seed: 99 }).generate(T0, 300_000);
    expect(a.map((e) => [e.t, e.type])).toEqual(b.map((e) => [e.t, e.type]));
  });

  it('differs between seeds', async () => {
    const built = await model();
    const a = new Simulator({ model: built, seed: 1 }).generate(T0, 300_000);
    const b = new Simulator({ model: built, seed: 2 }).generate(T0, 300_000);
    expect(a.map((e) => e.t)).not.toEqual(b.map((e) => e.t));
  });

  it('emits events in time order', async () => {
    const sim = new Simulator({ model: await model(), seed: 3 });
    const generated = sim.generate(T0, 600_000);
    const times = generated.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('gives every event a distinct id', async () => {
    // Ids collide easily when they are derived from the samples they copy, and a
    // duplicate id would make the client treat two events as one.
    const sim = new Simulator({ model: await model(), seed: 5 });
    const generated = [...sim.generate(T0, 600_000), ...sim.generate(T0 + 600_000, 600_000)];
    expect(new Set(generated.map((e) => e.id)).size).toBe(generated.length);
  });

  it('can still produce an event when the expected rate is below one per window', async () => {
    // At 3 a.m. the rate is well under one per window. Flooring would mean total
    // silence rather than an occasional aircraft, and §1.4 says never silent.
    const built = await model();
    let produced = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      produced += new Simulator({ model: built, seed, intensity: 0.02 }).generate(
        T0,
        60_000,
      ).length;
    }
    expect(produced).toBeGreaterThan(0);
  });

  it('produces nothing from an empty model rather than throwing', () => {
    const sim = new Simulator({
      model: { ratePerMinuteByHour: new Array<number>(24).fill(0), typeWeights: {}, samples: [] },
      seed: 1,
    });
    expect(sim.generate(T0, 600_000)).toEqual([]);
  });
});

describe('SimulatorFallback — takes over only when the real city is gone', () => {
  function setup(now: () => number) {
    const health = new HealthRegistry(3);
    health.register('primary');
    const fallback = new SimulatorFallback({
      sources: realSources(),
      health,
      seed: 1,
      now,
    });
    return { health, fallback };
  }

  it('produces nothing while a source is healthy', async () => {
    let clock = 1_000_000;
    const { health, fallback } = setup(() => clock);
    await fallback.loadModel([await recordingWith([event(), event({ id: 'b', t: T0 + 1000 })])]);
    health.recordSuccess('primary', clock, 100, 0);
    clock += 10 * 60_000;
    // Even long after, a healthy source means no replay — but note anyHealthy ages
    // out, so this also proves the staleness bound does not accidentally trigger it.
    health.recordSuccess('primary', clock, 100, 0);
    expect(fallback.tick()).toEqual([]);
    expect(fallback.isActive).toBe(false);
  });

  it('does not take over for a brief blip', async () => {
    // Swapping real traffic for a replay because of a ten-second outage would be
    // worse than a short gap: the replay is by definition not what is happening.
    let clock = 1_000_000;
    const { health, fallback } = setup(() => clock);
    await fallback.loadModel([await recordingWith([event()])]);
    health.recordFailure('primary', clock, 'down');
    clock += 30_000;
    expect(fallback.tick()).toEqual([]);
    expect(fallback.isActive).toBe(false);
  });

  it('takes over after a sustained outage, and marks everything', async () => {
    let clock = 1_000_000;
    const { health, fallback } = setup(() => clock);
    const events = Array.from({ length: 60 }, (_, i) =>
      event({ id: `e${String(i)}`, t: T0 + i * 10_000 }),
    );
    await fallback.loadModel([await recordingWith(events)]);
    health.recordFailure('primary', clock, 'down');

    clock += 10 * 60_000;
    let produced: CityEvent[] = [];
    for (let i = 0; i < 40 && produced.length === 0; i += 1) {
      produced = fallback.tick();
      clock += 10_000;
    }
    expect(fallback.isActive).toBe(true);
    for (const item of produced) {
      expect(item.sim).toBe(true);
      expect(item.caption).toContain('(replay)');
    }
  });

  it('hands back the moment a real source recovers', async () => {
    let clock = 1_000_000;
    const { health, fallback } = setup(() => clock);
    await fallback.loadModel([await recordingWith([event()])]);
    health.recordFailure('primary', clock, 'down');
    clock += 10 * 60_000;
    fallback.tick();
    expect(fallback.isActive).toBe(true);

    health.recordSuccess('primary', clock, 100, 0);
    expect(fallback.tick()).toEqual([]);
    expect(fallback.isActive).toBe(false);
  });

  it('is simply unavailable when there is no recorded history', () => {
    // Correct behaviour on a first run: no model, no fallback, no pretending.
    let clock = 1_000_000;
    const { health, fallback } = setup(() => clock);
    health.recordFailure('primary', clock, 'down');
    clock += 10 * 60_000;
    expect(fallback.hasModel).toBe(false);
    expect(fallback.tick()).toEqual([]);
  });
});
