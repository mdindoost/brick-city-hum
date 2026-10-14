import { describe, expect, it } from 'vitest';
import { feetPerMinuteToMps, feetToMetres, metresToFeet, mpsToFeetPerMinute } from './units.js';

/**
 * These conversions guard the one bug class that is silent: OpenSky reports altitude
 * in metres and vertical rate in m/s, adsb.lol reports feet and ft/min, and SPEC
 * §3.2's thresholds are in feet and ft/min (docs/verification.md).
 */
describe('altitude', () => {
  it('converts a known altitude', () => {
    // 10,000 ft is 3,048 m exactly, by the definition of the international foot.
    expect(feetToMetres(10000)).toBeCloseTo(3048, 6);
    expect(metresToFeet(3048)).toBeCloseTo(10000, 6);
  });

  it('round-trips', () => {
    expect(metresToFeet(feetToMetres(27025))).toBeCloseTo(27025, 6);
  });

  it('converts SPEC §3.2 thresholds correctly', () => {
    expect(feetToMetres(1500)).toBeCloseTo(457.2, 4); // departure altitude gate
    expect(feetToMetres(10000)).toBeCloseTo(3048, 4); // overflight_high boundary
  });
});

describe('vertical rate', () => {
  it('converts a typical climb rate', () => {
    // SPEC §3.2 fires a departure above +500 ft/min; a real observed value was
    // +2200 ft/min. In OpenSky's m/s these are ~2.54 and ~11.18.
    expect(feetPerMinuteToMps(500)).toBeCloseTo(2.54, 2);
    expect(feetPerMinuteToMps(2200)).toBeCloseTo(11.176, 3);
  });

  it('round-trips', () => {
    expect(mpsToFeetPerMinute(feetPerMinuteToMps(-1152))).toBeCloseTo(-1152, 6);
  });

  it('preserves sign, so a descent stays a descent', () => {
    expect(mpsToFeetPerMinute(-5)).toBeLessThan(0);
    expect(feetPerMinuteToMps(-300)).toBeLessThan(0);
  });
});
