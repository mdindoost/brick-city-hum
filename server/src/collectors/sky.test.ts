import { describe, expect, it } from 'vitest';
import { SkyCollector } from './sky.js';
import { realPlaces, realSources } from '../testing.js';

const collector = new SkyCollector({ sources: realSources(), places: realPlaces() });

/** A fixed October day in Newark, so the numbers below are stable. */
function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 9, 15, hour + 4, minute); // EDT is UTC−4
}

describe('SkyCollector units', () => {
  it('reports the sun in degrees, which is what this suncalc build returns', () => {
    // The guard that matters: a version returning radians would put noon at 0.7 and
    // a wrongly converted one at 2336, and either leaves the piece in permanent
    // night. Both are excluded by asserting a plausible solar altitude.
    const noon = collector.state(at(13)).sunAltitudeDeg;
    expect(noon).toBeGreaterThan(20);
    expect(noon).toBeLessThan(60);
    expect(collector.state(at(2)).sunAltitudeDeg).toBeLessThan(-20);
  });

  it('puts the sun in the south at midday and keeps azimuth in 0..360', () => {
    const noon = collector.state(at(13));
    expect(noon.sunAzimuthDeg).toBeGreaterThan(150);
    expect(noon.sunAzimuthDeg).toBeLessThan(210);
    for (const hour of [0, 6, 12, 18, 23]) {
      const azimuth = collector.state(at(hour)).sunAzimuthDeg;
      expect(azimuth).toBeGreaterThanOrEqual(0);
      expect(azimuth).toBeLessThan(360);
    }
  });
});

describe('dayparts follow the sky, not the clock', () => {
  it('is night in the small hours and day at midday', () => {
    expect(collector.state(at(2)).daypart).toBe('night');
    expect(collector.state(at(13)).daypart).toBe('day');
  });

  it('passes through twilight on the way up', () => {
    const parts = [5, 6, 7, 8, 13].map((h) => collector.state(at(h)).daypart);
    expect(parts[0]).toBe('night');
    expect(parts).toContain('twilight');
    expect(parts[parts.length - 1]).toBe('day');
  });

  it('reports progress inside the band, so a palette can crossfade', () => {
    for (const hour of [2, 6, 7, 9, 13, 18, 20]) {
      const progress = collector.state(at(hour)).daypartProgress;
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe('moments', () => {
  it('does not announce a sunrise that happened before we started', () => {
    // A restart at midday must not claim the morning's sunrise.
    const fresh = new SkyCollector({ sources: realSources(), places: realPlaces() });
    expect(fresh.tick(at(13)).events).toHaveLength(0);
    expect(fresh.tick(at(13, 1)).events).toHaveLength(0);
  });

  it('fires sunrise once as the sun crosses, and not again that day', () => {
    const fresh = new SkyCollector({ sources: realSources(), places: realPlaces() });
    const fired: string[] = [];
    for (let minute = 0; minute < 60 * 10; minute += 5) {
      for (const event of fresh.tick(at(4, minute)).events) fired.push(event.type);
    }
    expect(fired.filter((t) => t === 'sunrise')).toHaveLength(1);
  });

  it('flags a computed moment as not observed', () => {
    const fresh = new SkyCollector({ sources: realSources(), places: realPlaces() });
    let sunrise;
    for (let minute = 0; minute < 60 * 10; minute += 5) {
      const found = fresh.tick(at(4, minute)).events.find((e) => e.type === 'sunrise');
      if (found !== undefined) sunrise = found;
    }
    expect(sunrise?.scheduled).toBe(true);
    expect(sunrise?.sim).toBe(false);
  });
});
