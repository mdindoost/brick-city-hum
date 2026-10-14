import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dayStamp, Recorder } from './recorder.js';
import type { Observation } from './observation.js';

/** The timestamp from SPEC §4's sample event. Note it resolves to 2025-10-14. */
const SAMPLE_T = 1760458800123;

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    icao: 'a4460f',
    t: SAMPLE_T,
    lat: 40.69,
    lon: -74.17,
    altFt: 1600,
    onGround: false,
    verticalRateFpm: 2200,
    groundSpeedKt: 210,
    category: 'A3',
    identity: 'airline',
    callsign: 'UAL1810',
    typeCode: 'B738',
    source: 'adsb.lol',
    ...overrides,
  };
}

function readLines(dir: string, suffix: string): unknown[] {
  const file = readdirSync(dir).find((name) => name.endsWith(suffix));
  if (file === undefined) throw new Error(`no file ending ${suffix} in ${dir}`);
  // Each line is its own gzip member; gunzipSync reads the concatenation.
  const text = gunzipSync(readFileSync(join(dir, file))).toString('utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe('dayStamp', () => {
  it('is UTC, so a day boundary is never duplicated or skipped', () => {
    // Newark local time would shift twice a year, duplicating or skipping an hour in
    // files that are keyed by day.
    expect(dayStamp(Date.UTC(2026, 9, 14, 23, 59, 59))).toBe('2026-10-14');
    expect(dayStamp(Date.UTC(2026, 9, 15, 0, 0, 1))).toBe('2026-10-15');
  });
});

describe('Recorder', () => {
  it('writes observations as readable gzipped ndjson', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bch-rec-'));
    const recorder = new Recorder({ directory: dir });
    recorder.recordObservations([observation()], SAMPLE_T);
    recorder.recordObservations([observation({ icao: 'abc123' })], SAMPLE_T + 10_000);
    await recorder.close();

    const lines = readLines(dir, '-observation.ndjson.gz');
    expect(lines).toHaveLength(2);
  });

  it('keeps observations and raw records in separate files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bch-rec-'));
    const recorder = new Recorder({ directory: dir });
    recorder.recordObservations([observation()], SAMPLE_T);
    recorder.recordRaw('adsb.lol', [{ hex: 'a4460f', alt_baro: 1600 }], SAMPLE_T);
    await recorder.close();

    // Derived, not hard-coded: SPEC §4's sample `t: 1760458800123` is actually
    // 2025-10-14, a year before the spec's own date. Deriving the name keeps the
    // test honest about whatever timestamp it is given.
    const day = dayStamp(SAMPLE_T);
    const names = readdirSync(dir);
    expect(names).toContain(`${day}-observation.ndjson.gz`);
    expect(names).toContain(`${day}-raw.ndjson.gz`);
  });

  it('appends rather than truncating, so a restart costs no history', async () => {
    // SPEC §11.3 runs this under Docker with restart: unless-stopped, and §13 needs
    // 48 unbroken hours. Truncating on boot would quietly restart the clock.
    const dir = mkdtempSync(join(tmpdir(), 'bch-rec-'));
    const first = new Recorder({ directory: dir });
    first.recordObservations([observation()], SAMPLE_T);
    await first.close();

    const second = new Recorder({ directory: dir });
    second.recordObservations([observation({ icao: 'second' })], SAMPLE_T + 10_000);
    await second.close();

    expect(readLines(dir, '-observation.ndjson.gz')).toHaveLength(2);
  });

  it('rolls over to a new file at the UTC day boundary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bch-rec-'));
    const recorder = new Recorder({ directory: dir });
    recorder.recordObservations([observation()], Date.UTC(2026, 9, 14, 23, 59, 59));
    recorder.recordObservations([observation()], Date.UTC(2026, 9, 15, 0, 0, 1));
    await recorder.close();

    const names = readdirSync(dir).filter((n) => n.endsWith('-observation.ndjson.gz'));
    expect(names).toHaveLength(2);
  });

  it('writes nothing for an empty poll', async () => {
    // An empty sky is information, but it is not a record worth a line every 10
    // seconds all night.
    const dir = mkdtempSync(join(tmpdir(), 'bch-rec-'));
    const recorder = new Recorder({ directory: dir });
    recorder.recordObservations([], SAMPLE_T);
    recorder.recordRaw('adsb.lol', [], SAMPLE_T);
    await recorder.close();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('records no identity, even if a caller passes some', async () => {
    // Defence in depth. Stripping happens in the collector (§3.7), but these files
    // are append-only: if identity ever reaches them it cannot be removed by a later
    // code fix. This test documents what must never appear here.
    const dir = mkdtempSync(join(tmpdir(), 'bch-rec-'));
    const recorder = new Recorder({ directory: dir });
    recorder.recordObservations(
      [observation({ identity: 'private', callsign: null })],
      1760458800123,
    );
    await recorder.close();

    const text = JSON.stringify(readLines(dir, '-observation.ndjson.gz'));
    expect(text).not.toMatch(/"r":/);
    expect(text).not.toMatch(/registration/i);
    expect(text).not.toMatch(/\bN\d{3,5}[A-Z]{0,2}\b/);
  });
});
