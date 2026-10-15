import { describe, expect, it } from 'vitest';
import { TrackStore } from './tracks.js';
import type { Observation } from './observation.js';

const T0 = 1760458800000;

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    icao: 'a4460f',
    t: T0,
    lat: 40.69,
    lon: -74.17,
    trackDeg: null,
    altFt: 1600,
    onGround: false,
    verticalRateFpm: 2200,
    groundSpeedKt: 210,
    category: 'A3',
    identity: 'airline',
    callsign: 'UAL1810',
    typeCode: 'B738',
    source: 'adsb.lol',
    positionAgeS: 0.4,
    ...overrides,
  };
}

function store(max = 10, expireAfterMs = 300_000) {
  return new TrackStore({ maxObservations: max, expireAfterMs });
}

describe('TrackStore', () => {
  it('keeps history newest last, which is what the detector relies on', () => {
    const tracks = store();
    tracks.add(observation({ t: T0, altFt: 500 }));
    tracks.add(observation({ t: T0 + 10_000, altFt: 1200 }));
    const history = tracks.add(observation({ t: T0 + 20_000, altFt: 2000 }));
    expect(history.map((o) => o.altFt)).toEqual([500, 1200, 2000]);
  });

  it('bounds history to the configured window (SPEC §3.2: ~10 observations)', () => {
    const tracks = store(10);
    for (let i = 0; i < 25; i += 1) {
      tracks.add(observation({ t: T0 + i * 10_000 }));
    }
    expect(tracks.get('a4460f')).toHaveLength(10);
    // And keeps the newest ten, not the oldest.
    expect(tracks.get('a4460f')[9]?.t).toBe(T0 + 24 * 10_000);
  });

  it('keeps aircraft separate', () => {
    const tracks = store();
    tracks.add(observation({ icao: 'aaa' }));
    tracks.add(observation({ icao: 'bbb' }));
    expect(tracks.get('aaa')).toHaveLength(1);
    expect(tracks.get('bbb')).toHaveLength(1);
    expect(tracks.size).toBe(2);
  });

  it('ignores an exact duplicate of the latest reading', () => {
    // Sources repeat positions. Letting a duplicate in would make a stalled feed
    // look like level flight and could suppress a real climb.
    const tracks = store();
    tracks.add(observation({ t: T0 }));
    const history = tracks.add(observation({ t: T0 }));
    expect(history).toHaveLength(1);
  });

  it('inserts an out-of-order observation in time order', () => {
    // A retry after a backoff can deliver an older reading after a newer one. The
    // detector trusts that the last element is the most recent, so order matters.
    const tracks = store();
    tracks.add(observation({ t: T0, altFt: 100 }));
    tracks.add(observation({ t: T0 + 20_000, altFt: 300 }));
    const history = tracks.add(observation({ t: T0 + 10_000, altFt: 200 }));
    expect(history.map((o) => o.altFt)).toEqual([100, 200, 300]);
    expect(history[history.length - 1]?.t).toBe(T0 + 20_000);
  });

  it('returns an empty history for an unknown aircraft rather than undefined', () => {
    expect(store().get('nope')).toEqual([]);
  });

  it('forgets aircraft not seen within the expiry window', () => {
    // Without this, a day of New York-area traffic grows the store without bound on
    // a laptop that is also running an audio server.
    const tracks = store(10, 300_000);
    tracks.add(observation({ icao: 'old', t: T0 }));
    tracks.add(observation({ icao: 'fresh', t: T0 + 290_000 }));
    const dropped = tracks.expire(T0 + 400_000);
    expect(dropped).toBe(1);
    expect(tracks.get('old')).toEqual([]);
    expect(tracks.get('fresh')).toHaveLength(1);
    expect(tracks.size).toBe(1);
  });

  it('survives an aircraft that reappears after expiry', () => {
    const tracks = store(10, 60_000);
    tracks.add(observation({ t: T0 }));
    tracks.expire(T0 + 120_000);
    const history = tracks.add(observation({ t: T0 + 130_000 }));
    expect(history).toHaveLength(1);
  });
});
