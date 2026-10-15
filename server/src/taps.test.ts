import { describe, expect, it } from 'vitest';
import { TapLimiter } from './taps.js';
import { realPlaces, realSources } from './testing.js';

const sources = realSources();
const places = realPlaces();

function limiter(): TapLimiter {
  return new TapLimiter({ sources, places });
}

const middle = { x: 0.5, y: 0.5, department: null };

describe('TapLimiter', () => {
  it('accepts a tap and refuses the same connection again too soon', () => {
    // §8: one tap per two seconds per connection. Enforced here and not in the
    // browser, because a client-side limit is a suggestion.
    const taps = limiter();
    const socket = {};
    expect(taps.accept(socket, middle, 1000)).not.toBeNull();
    expect(taps.accept(socket, middle, 1500)).toBeNull();
    expect(taps.accept(socket, middle, 1000 + sources.taps.min_interval_ms)).not.toBeNull();
  });

  it('limits everyone together, not just each connection', () => {
    const taps = limiter();
    const accepted = Array.from({ length: 20 }, () => taps.accept({}, middle, 5000)).filter(
      (event) => event !== null,
    );
    expect(accepted).toHaveLength(sources.taps.global_per_second);
  });

  it('lets the global ceiling refill as the second passes', () => {
    const taps = limiter();
    for (let i = 0; i < sources.taps.global_per_second; i += 1) taps.accept({}, middle, 5000);
    expect(taps.accept({}, middle, 5500)).toBeNull();
    expect(taps.accept({}, middle, 6100)).not.toBeNull();
  });

  it('maps the screen the way §8 describes', () => {
    const taps = limiter();
    const left = taps.accept({}, { x: 0.02, y: 0.5, department: null }, 1000)!;
    const right = taps.accept({}, { x: 0.98, y: 0.5, department: null }, 10_000)!;
    // x is pitch: left is lower than right.
    expect(left.tap!.degree).toBeLessThan(right.tap!.degree);
    // y is the instrument family: the top is a different one from the bottom.
    const top = taps.accept({}, { x: 0.5, y: 0.05, department: null }, 20_000)!;
    const bottom = taps.accept({}, { x: 0.5, y: 0.95, department: null }, 30_000)!;
    expect(top.tap!.register).not.toBe(bottom.tap!.register);
    // Distance from the centre is the pan, so a tap at the centre is not spread.
    const centre = taps.accept({}, middle, 40_000)!;
    expect(centre.rel.distance_km).toBeLessThan(left.rel.distance_km);
  });

  it('carries no identifier of any kind', () => {
    // §8: taps are never stored with an identifier. The structural version of that
    // promise is that there is nothing in the event to leak.
    const event = limiter().accept({}, { x: 0.3, y: 0.7, department: 'Engineering' }, 1000)!;
    expect(event.attrs.callsign).toBeNull();
    expect(event.attrs.operator).toBeNull();
    expect(event.caption).not.toContain('Engineering');
    expect(JSON.stringify(event)).not.toContain('127.0.0.1');
  });

  it('ignores a department it does not recognise', () => {
    const event = limiter().accept({}, { x: 0.5, y: 0.5, department: '<script>' }, 1000)!;
    expect(event.tap?.department).toBeNull();
  });

  it('survives coordinates that are not on the screen', () => {
    // A hand-written client can send anything at all.
    const taps = limiter();
    for (const [x, y] of [
      [Number.NaN, 0.5],
      [-5, 2],
      [Infinity, -Infinity],
    ] as [number, number][]) {
      const event = taps.accept({}, { x, y, department: null }, Date.now() + x * 0);
      if (event === null) continue;
      expect(Number.isFinite(event.rel.bearing_deg)).toBe(true);
      expect(Number.isFinite(event.rel.distance_km)).toBe(true);
    }
  });
});
