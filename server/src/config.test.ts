import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlaces } from './config.js';
import { bearingDeg, distanceKm, kmToNauticalMiles } from './geo.js';

/** Write a places.yaml into a throwaway directory and return the directory. */
function configDirWith(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bch-config-'));
  writeFileSync(join(dir, 'places.yaml'), yaml);
  return dir;
}

const VALID = `
origin: { id: njit, name: NJIT, lat: 40.74194, lon: -74.17889 }
places:
  ewr: { name: EWR, lat: 40.69248, lon: -74.16869 }
  newark_penn: { name: Penn, lat: 40.73472, lon: -74.16417 }
  prudential_center: { name: Pru, lat: 40.73361, lon: -74.17111 }
  port_newark: { name: Port, lat: 40.6816, lon: -74.1505 }
ewr_runways:
  - { id: '04L', threshold: { lat: 40.675381, lon: -74.179449 }, true_heading_deg: 26, length_ft: 11000 }
`;

describe('the real config/places.yaml', () => {
  const places = loadPlaces();

  it('loads and validates', () => {
    expect(places.origin.id).toBe('njit');
    expect(places.places.ewr.name).toContain('Newark Liberty');
  });

  it('puts every named place within the 25 nm poll radius of the origin', () => {
    for (const [id, place] of Object.entries(places.places)) {
      const nm = kmToNauticalMiles(distanceKm(places.origin, place));
      expect(nm, `${id} is ${nm.toFixed(1)} nm from the origin`).toBeLessThan(25);
    }
  });

  it('places EWR south of NJIT, as the real airport is', () => {
    const bearing = bearingDeg(places.origin, places.places.ewr);
    expect(bearing).toBeGreaterThan(135);
    expect(bearing).toBeLessThan(225);
  });

  describe('runway geometry', () => {
    const pairs = [
      ['04L', '22R'],
      ['04R', '22L'],
      ['11', '29'],
    ] as const;

    function runway(id: string) {
      const found = places.ewr_runways.find((r) => r.id === id);
      if (found === undefined) throw new Error(`places.yaml has no runway ${id}`);
      return found;
    }

    it.each(pairs)('%s and %s have reciprocal headings', (a, b) => {
      expect(Math.abs(runway(a).true_heading_deg - runway(b).true_heading_deg)).toBe(180);
    });

    it.each(pairs)('%s/%s measured length matches its published length', (a, b) => {
      const measuredFt = (distanceKm(runway(a).threshold, runway(b).threshold) * 1000) / 0.3048;
      expect(measuredFt).toBeCloseTo(runway(a).length_ft, -2);
    });

    it.each(pairs)('%s/%s published heading matches its own thresholds', (a, b) => {
      // Without this, a transposed heading in the YAML is caught by nothing: the
      // reciprocal test above accepts any pair differing by 180 (04L: 62 / 22R: 242
      // would pass), and geo.test.ts checks headings against coordinates hard-coded
      // in the test rather than against this file.
      const computed = bearingDeg(runway(a).threshold, runway(b).threshold);
      expect(computed, `${a} published ${String(runway(a).true_heading_deg)}°`).toBeCloseTo(
        runway(a).true_heading_deg,
        0,
      );
    });
  });
});

describe('validation rejects', () => {
  it('a valid fixture, as a control', () => {
    expect(() => loadPlaces(configDirWith(VALID))).not.toThrow();
  });

  it('a transposed lat/lon', () => {
    // The case that type and range checks cannot catch: both values stay inside
    // ±90/±180, so only the plausibility box sees it.
    const yaml = VALID.replace('lat: 40.74194, lon: -74.17889', 'lat: -74.17889, lon: 40.74194');
    expect(() => loadPlaces(configDirWith(yaml))).toThrow(/Newark area/);
  });

  it('a dropped minus sign on a longitude', () => {
    const yaml = VALID.replace('lon: -74.16869', 'lon: 74.16869');
    expect(() => loadPlaces(configDirWith(yaml))).toThrow(/Newark area/);
  });

  it('a one-digit slip on a latitude', () => {
    const yaml = VALID.replace('lat: 40.74194', 'lat: 41.74194');
    expect(() => loadPlaces(configDirWith(yaml))).toThrow(/Newark area/);
  });

  it('a renamed reference point', () => {
    // SPEC §3.2 names these points and the detector gates on `ewr`. An open record
    // would accept the typo and fail later, inside the detector.
    const yaml = VALID.replace('ewr: {', 'eww: {');
    expect(() => loadPlaces(configDirWith(yaml))).toThrow(/ewr/);
  });

  it('a string where a number belongs', () => {
    const yaml = VALID.replace('lat: 40.69248', "lat: '40.69248'");
    expect(() => loadPlaces(configDirWith(yaml))).toThrow(/expected number/);
  });

  it('a heading of exactly 360, which is outside [0, 360)', () => {
    const yaml = VALID.replace('true_heading_deg: 26', 'true_heading_deg: 360');
    expect(() => loadPlaces(configDirWith(yaml))).toThrow();
  });

  it('malformed YAML, and says where', () => {
    // Guards the diagnostic itself: the parser's line and column must reach the
    // message, not be buried in `.cause` where nothing prints it.
    expect(() => loadPlaces(configDirWith('origin: [:\n'))).toThrow(/not valid YAML/);
  });

  it('a missing file', () => {
    expect(() => loadPlaces(mkdtempSync(join(tmpdir(), 'bch-empty-')))).toThrow(
      /Could not read config file/,
    );
  });
});
