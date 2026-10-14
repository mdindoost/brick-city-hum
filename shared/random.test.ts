import { describe, expect, it } from 'vitest';
import { humanise, mulberry32, pick, randomForEvent, seedFromString } from './random.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    // The whole point: two listeners with the same seed must make the same choices,
    // and a lab render must reproduce bit-identically (§5, §7.3).
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 50 }, () => a());
    const second = Array.from({ length: 50 }, () => b());
    expect(first).toEqual(second);
  });

  it('gives different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays in [0, 1)', () => {
    const random = mulberry32(99);
    for (let i = 0; i < 2000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform, so jitter does not bias one direction', () => {
    const random = mulberry32(7);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 20_000; i += 1) {
      const index = Math.floor(random() * 10);
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1500);
      expect(count).toBeLessThan(2500);
    }
  });

  it('produces known values, pinning the algorithm across engines', () => {
    // A PRNG whose output differed between Node and Chromium would make the lab's
    // renders disagree with what listeners actually hear. These are the reference
    // values; if they change, the implementation changed.
    const random = mulberry32(42);
    expect(random()).toBeCloseTo(0.6011037519201636, 15);
    expect(random()).toBeCloseTo(0.44829055899754167, 15);
    expect(random()).toBeCloseTo(0.8524657934904099, 15);
  });
});

describe('seedFromString', () => {
  it('is stable', () => {
    expect(seedFromString('2026-10-14T18:03Z|section-7')).toBe(
      seedFromString('2026-10-14T18:03Z|section-7'),
    );
  });

  it('separates similar strings', () => {
    expect(seedFromString('section-7')).not.toBe(seedFromString('section-8'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const text of ['', 'a', 'section-7', '🚁']) {
      const seed = seedFromString(text);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('randomForEvent', () => {
  it('gives the same stream for the same event and section', () => {
    const a = randomForEvent(1234, 'evt_01J');
    const b = randomForEvent(1234, 'evt_01J');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('does not depend on how many events came before', () => {
    // A single shared stream would make every draw depend on arrival order, so a
    // client that joined a minute later would diverge from then on — and so would a
    // lab render that started at a different offset.
    const direct = randomForEvent(1234, 'evt_target');
    const noise = randomForEvent(1234, 'evt_other');
    for (let i = 0; i < 100; i += 1) noise();
    const afterNoise = randomForEvent(1234, 'evt_target');
    expect(direct()).toBe(afterNoise());
  });

  it('gives different streams to different events', () => {
    expect(randomForEvent(1234, 'evt_a')()).not.toBe(randomForEvent(1234, 'evt_b')());
  });
});

describe('humanise', () => {
  it('stays within the requested spread', () => {
    const random = mulberry32(3);
    for (let i = 0; i < 1000; i += 1) {
      const offset = humanise(random, 25);
      expect(Math.abs(offset)).toBeLessThanOrEqual(0.025);
    }
  });

  it('is centred, so timing does not drift one way', () => {
    const random = mulberry32(5);
    let total = 0;
    for (let i = 0; i < 10_000; i += 1) total += humanise(random, 25);
    expect(Math.abs(total / 10_000)).toBeLessThan(0.001);
  });
});

describe('pick', () => {
  it('returns undefined for an empty list rather than throwing', () => {
    expect(pick(mulberry32(1), [])).toBeUndefined();
  });

  it('only ever returns a member of the list', () => {
    const items = ['a', 'b', 'c'] as const;
    const random = mulberry32(11);
    for (let i = 0; i < 500; i += 1) {
      expect(items).toContain(pick(random, items));
    }
  });
});
