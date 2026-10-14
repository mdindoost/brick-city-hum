import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  distanceKm,
  isWithinKm,
  kmToNauticalMiles,
  nauticalMilesToKm,
  type LatLon,
} from './geo.js';

/**
 * Fixtures are the verified coordinates from docs/verification.md, and the expected
 * values were computed independently in Python with a second formula (spherical law
 * of cosines) before this file was written — not read back out of this implementation.
 */
const NJIT: LatLon = { lat: 40.74194, lon: -74.17889 };
const EWR: LatLon = { lat: 40.69248, lon: -74.16869 };
const NEWARK_PENN: LatLon = { lat: 40.73472, lon: -74.16417 };

describe('distanceKm', () => {
  it('measures NJIT to EWR', () => {
    expect(distanceKm(NJIT, EWR)).toBeCloseTo(5.566488, 4);
  });

  it('measures NJIT to Newark Penn', () => {
    expect(distanceKm(NJIT, NEWARK_PENN)).toBeCloseTo(1.477367, 4);
  });

  it('is zero for a point against itself', () => {
    expect(distanceKm(NJIT, NJIT)).toBe(0);
  });

  it('is symmetric', () => {
    expect(distanceKm(NJIT, EWR)).toBeCloseTo(distanceKm(EWR, NJIT), 10);
  });

  it('gives the spherical value for one degree of latitude at the equator', () => {
    // NOT an Earth fact: 111.19508 km is exactly EARTH_RADIUS_KM × π/180. On the
    // WGS-84 ellipsoid a degree of latitude at the equator is 110.574 km, 0.56%
    // away. This fixture pins the formula and the radius constant, not reality —
    // it catches a wrong formula or a flat-grid mistake, nothing more. Do not
    // "correct" it to the ellipsoid value without changing the model.
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19508, 4);
  });

  it('shortens a degree of longitude with latitude', () => {
    // The property under test is real and important: a degree of longitude is much
    // shorter at Newark's latitude than at the equator, and treating degrees as a
    // flat grid would stretch the city east-west. The exact figure, though, is the
    // sphere's (84.300 km); on the ellipsoid it is 84.515 km.
    expect(distanceKm({ lat: 40.7, lon: 0 }, { lat: 40.7, lon: 1 })).toBeCloseTo(84.300353, 4);
    expect(distanceKm({ lat: 40.7, lon: 0 }, { lat: 40.7, lon: 1 })).toBeLessThan(
      distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }),
    );
  });

  it('crosses the antimeridian without blowing up', () => {
    // 179°E to 179°W is 2 degrees apart, not 358. A naive longitude subtraction
    // would give a wildly wrong distance.
    expect(distanceKm({ lat: 40, lon: 179 }, { lat: 40, lon: -179 })).toBeCloseTo(170.357173, 3);
  });
});

describe('bearingDeg', () => {
  it('agrees with the example in SPEC §4', () => {
    // SPEC §4's sample event sits at EWR and carries bearing_deg: 172. This test is
    // what pins the convention: bearing is measured FROM the origin TO the aircraft,
    // clockwise from true north. If this ever flips, every plane swaps stereo side.
    expect(bearingDeg(NJIT, EWR)).toBeCloseTo(171.1128, 3);
  });

  it('reports EWR as south of NJIT', () => {
    const bearing = bearingDeg(NJIT, EWR);
    expect(bearing).toBeGreaterThan(135);
    expect(bearing).toBeLessThan(225);
  });

  it('handles the four cardinal directions', () => {
    expect(bearingDeg({ lat: 40, lon: -74 }, { lat: 41, lon: -74 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 41, lon: -74 }, { lat: 40, lon: -74 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 6);
  });

  it('always returns a value in [0, 360)', () => {
    const points: LatLon[] = [
      { lat: 40.8, lon: -74.3 },
      { lat: 40.6, lon: -74.0 },
      { lat: 41.0, lon: -73.8 },
      { lat: 40.5, lon: -74.4 },
      { lat: 40.74194, lon: -74.3 },
    ];
    for (const point of points) {
      const bearing = bearingDeg(NJIT, point);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });

  it('returns 0 for a point against itself', () => {
    // Degenerate but a real production input: SPEC §3.2's overflight_city circle is
    // 3 km, so an aircraft can pass essentially over the origin. 0° maps to centre
    // pan, which is the benign answer. Pinned so it cannot drift to NaN.
    expect(bearingDeg(NJIT, NJIT)).toBe(0);
  });

  it('is not symmetric — the reverse bearing differs by ~180°, but not exactly', () => {
    // Worth knowing rather than asserting away: forward and reverse bearings differ
    // by exactly 180° only along a meridian or the equator. Elsewhere the meridians
    // converge. Here NJIT→EWR is 171.11279° and EWR→NJIT is 351.11945°, a
    // difference of 180.00665°. A test demanding exactly 180 would be wrong about
    // the Earth.
    const out = bearingDeg(NJIT, EWR);
    const back = bearingDeg(EWR, NJIT);
    const difference = Math.abs(back - out) % 360;
    expect(Math.abs(difference - 180)).toBeLessThan(0.05);
    expect(difference).not.toBe(180);
  });
});

describe('against FAA-published runway geometry', () => {
  // The strongest check available: EWR's runway lengths and headings are published
  // by the FAA, so this validates distance AND bearing against an outside authority
  // rather than against our own arithmetic.
  //
  // Tolerance is derived, not guessed. Measured against WGS-84 the FAA threshold
  // coordinates reproduce the published lengths to within half a foot, so
  // essentially all the error here is the spherical model — and its SIGN FLIPS WITH
  // ORIENTATION, because at 40.7° the prime-vertical radius (6387 km) and the
  // meridional (6362 km) bracket the mean radius we use (6371.0088 km). The
  // north-easterly parallels read ~2 m long; the east-west crosswind pair reads
  // ~5 m short. 8 m covers both with margin. An earlier version of this test used
  // 5 m and only tested 04L/22R — it passed solely because that is the favourable
  // orientation.
  const SPHERICAL_MODEL_TOLERANCE_M = 8;
  const FEET_TO_METRES = 0.3048;

  const strips = [
    {
      name: '04L/22R',
      from: { lat: 40.675381, lon: -74.179449 },
      to: { lat: 40.70256, lon: -74.162172 },
      publishedFt: 11000,
      publishedHeading: 26,
    },
    {
      name: '04R/22L',
      from: { lat: 40.677584, lon: -74.174245 },
      to: { lat: 40.702289, lon: -74.158537 },
      publishedFt: 9999,
      publishedHeading: 26,
    },
    {
      name: '11/29',
      from: { lat: 40.702804, lon: -74.180707 },
      to: { lat: 40.701199, lon: -74.156543 },
      publishedFt: 6725,
      publishedHeading: 95,
    },
  ] as const;

  for (const strip of strips) {
    it(`reproduces runway ${strip.name}'s published length`, () => {
      const computedM = distanceKm(strip.from, strip.to) * 1000;
      const publishedM = strip.publishedFt * FEET_TO_METRES;
      expect(Math.abs(computedM - publishedM)).toBeLessThan(SPHERICAL_MODEL_TOLERANCE_M);
    });

    it(`reproduces runway ${strip.name}'s published true heading`, () => {
      // A reversed or counterclockwise bearing convention would give 205.7° or
      // 334.3° for 04L and fail loudly here.
      expect(bearingDeg(strip.from, strip.to)).toBeCloseTo(strip.publishedHeading, 0);
    });
  }
});

describe('isWithinKm', () => {
  it('includes a point inside the radius', () => {
    expect(isWithinKm(NJIT, EWR, 6)).toBe(true);
  });

  it('excludes a point outside the radius', () => {
    expect(isWithinKm(NJIT, EWR, 5)).toBe(false);
  });

  it('is inclusive exactly at the boundary', () => {
    expect(isWithinKm(NJIT, EWR, distanceKm(NJIT, EWR))).toBe(true);
  });

  it('includes the centre itself', () => {
    expect(isWithinKm(NJIT, NJIT, 0)).toBe(true);
  });
});

describe('nautical mile conversion', () => {
  it('converts the SPEC §3.2 poll radius of 25 nm', () => {
    expect(nauticalMilesToKm(25)).toBeCloseTo(46.3, 6);
  });

  it('puts EWR about 3 nm from NJIT', () => {
    expect(kmToNauticalMiles(distanceKm(NJIT, EWR))).toBeCloseTo(3.0057, 3);
  });

  it('round-trips', () => {
    expect(kmToNauticalMiles(nauticalMilesToKm(17.3))).toBeCloseTo(17.3, 10);
  });
});
