import { describe, expect, it } from 'vitest';
import { parseRidePath, PathDetector } from './path.js';
import { realPlaces, realSources } from '../testing.js';

const places = realPlaces();
const sources = realSources();

let counter = 0;
function detector(): PathDetector {
  counter = 0;
  return new PathDetector({ sources, places, makeId: () => `path_${String(++counter)}` });
}

/** A trimmed copy of a real response, captured 2026-10-14. */
function response(nwkSeconds: number[], harSeconds: number[] = []): unknown {
  const messages = (seconds: number[], headSign: string): unknown[] =>
    seconds.map((value) => ({
      target: 'WTC',
      secondsToArrival: String(value),
      arrivalTimeMessage: `${String(Math.round(value / 60))} min`,
      lineColor: 'D93A30',
      headSign,
      lastUpdated: '2026-10-14T19:50:55.482936-04:00',
    }));
  return {
    results: [
      {
        consideredStation: 'NWK',
        destinations: [{ label: 'ToNY', messages: messages(nwkSeconds, 'World Trade Center') }],
      },
      {
        consideredStation: 'HAR',
        destinations: [{ label: 'ToNJ', messages: messages(harSeconds, 'Newark') }],
      },
      // A station we are not listening to must be parsed and then ignored.
      {
        consideredStation: 'JSQ',
        destinations: [{ label: 'ToNJ', messages: messages([20], 'Newark') }],
      },
    ],
  };
}

describe('parseRidePath', () => {
  it('keeps only the nearest train on each platform', () => {
    const { platforms, skipped } = parseRidePath(response([304, 904], [41]));
    expect(skipped).toBe(0);
    expect(platforms.find((p) => p.station === 'NWK')?.seconds).toBe(304);
    expect(platforms.find((p) => p.station === 'HAR')?.seconds).toBe(41);
  });

  it('survives a shape it does not recognise rather than throwing', () => {
    // An undocumented feed may change at any time, and the radio must keep playing
    // (§1.4) rather than crash on a renamed field.
    expect(parseRidePath({ results: 'nope' })).toEqual({ platforms: [], skipped: 1 });
    expect(parseRidePath(null)).toEqual({ platforms: [], skipped: 1 });
  });

  it('skips a countdown that is not a number', () => {
    const body = {
      results: [
        {
          consideredStation: 'NWK',
          destinations: [{ label: 'ToNY', messages: [{ secondsToArrival: 'Delayed' }] }],
        },
      ],
    };
    expect(parseRidePath(body)).toEqual({ platforms: [], skipped: 1 });
  });
});

describe('PathDetector', () => {
  it('fires an approach, then an arrival, and nothing in between', () => {
    const d = detector();
    const at = 1_760_000_000_000;
    const types = (seconds: number): string[] =>
      d.detect(parseRidePath(response([seconds])).platforms, at).map((e) => e.type);

    expect(types(600)).toEqual([]);
    expect(types(200)).toEqual(['path_approaching']);
    expect(types(120)).toEqual([]);
    expect(types(60)).toEqual([]);
    expect(types(20)).toEqual(['path_arrival']);
    expect(types(0)).toEqual([]);
  });

  it('gives a train first seen inside the arrival gate one bell, not two', () => {
    // Two struck notes at the same instant read as one louder note, so the approach
    // that exists to precede an arrival would be heard as neither.
    const d = detector();
    const types = d.detect(parseRidePath(response([15])).platforms, 1).map((e) => e.type);
    expect(types).toEqual(['path_arrival']);
  });

  it('rearms only when the countdown climbs clear, so one train is one event', () => {
    const d = detector();
    const fire = (seconds: number): string[] =>
      d.detect(parseRidePath(response([seconds])).platforms, 1).map((e) => e.type);

    expect(fire(200)).toEqual(['path_approaching']);
    expect(fire(20)).toEqual(['path_arrival']);
    // The same train jittering about the gate must not announce itself again.
    expect(fire(30)).toEqual([]);
    expect(fire(100)).toEqual([]);
    // The next train, several minutes out.
    expect(fire(500)).toEqual([]);
    expect(fire(200)).toEqual(['path_approaching']);
  });

  it('ignores stations we are not listening to', () => {
    const d = detector();
    const events = d.detect(parseRidePath(response([], [])).platforms, 1);
    expect(events.every((e) => !e.caption.includes('Journal Square'))).toBe(true);
  });

  it('places the event at the station, not at the listener', () => {
    const d = detector();
    const event = d.detect(parseRidePath(response([20])).platforms, 1)[0]!;
    expect(event.geo.lat).toBeCloseTo(places.places.newark_penn.lat, 4);
    // Newark Penn is about 1.5 km south-east of campus.
    expect(event.rel.distance_km).toBeGreaterThan(1);
    expect(event.rel.distance_km).toBeLessThan(2.5);
  });

  it('names where the train is going, so two platforms are not one sentence', () => {
    const d = detector();
    const captions = d
      .detect(parseRidePath(response([20], [20])).platforms, 1)
      .map((e) => e.caption);
    expect(captions).toHaveLength(2);
    expect(new Set(captions).size).toBe(2);
    expect(captions.some((c) => c.includes('World Trade Center'))).toBe(true);
  });

  it('carries no identifier of any kind', () => {
    // §3.2 is about aircraft, but the rule is the project's: nothing in an event may
    // identify a person or a vehicle.
    const d = detector();
    const event = d.detect(parseRidePath(response([20])).platforms, 1)[0]!;
    expect(event.attrs.callsign).toBeNull();
    expect(event.attrs.operator).toBeNull();
    expect(event.attrs.described_as).toBe('a PATH train');
  });
});
