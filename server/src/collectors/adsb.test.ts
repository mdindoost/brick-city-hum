import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IDENTIFYING_FIELDS,
  parseAdsbResponse,
  stripIdentifyingFields,
  toObservation,
  type RawAircraft,
} from './adsb.js';
import { classifyCallsign } from '../observation.js';

const RECEIVED_AT = 1760458800123;

const fixture: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '__fixtures__', 'adsb-lol-sample.json'), 'utf8'),
);

function aircraft(overrides: Partial<RawAircraft> = {}): RawAircraft {
  return { hex: 'a4460f', lat: 40.69, lon: -74.17, ...overrides };
}

describe('alt_baro, the field that is a number or the string "ground"', () => {
  // The highest-value test in the collector. In a real 100-aircraft response, 48 were
  // on the ground. A numeric parse of "ground" gives NaN, every altitude comparison
  // then reads false, and SPEC §3.2's departure rule — which requires knowing the
  // aircraft WAS on the ground — produces phantom departures from parked aircraft.
  it('reads "ground" as on-ground with unknown altitude, not as NaN or zero', () => {
    const observation = toObservation(aircraft({ alt_baro: 'ground' }), RECEIVED_AT, 'test');
    expect(observation?.onGround).toBe(true);
    expect(observation?.altFt).toBeNull();
  });

  it('reads a numeric altitude as airborne', () => {
    const observation = toObservation(aircraft({ alt_baro: 27025 }), RECEIVED_AT, 'test');
    expect(observation?.onGround).toBe(false);
    expect(observation?.altFt).toBe(27025);
  });

  it('never yields NaN for altitude', () => {
    for (const alt of ['ground', 0, 27025, undefined] as const) {
      const observation = toObservation(aircraft({ alt_baro: alt }), RECEIVED_AT, 'test');
      expect(Number.isNaN(observation?.altFt)).toBe(false);
    }
  });

  it('treats altitude 0 as airborne, not as ground', () => {
    // 0 ft is a real barometric reading, and `0` is falsy — a truthiness check here
    // would call an aircraft at field elevation "on the ground" and suppress a
    // departure at the exact moment it matters.
    const observation = toObservation(aircraft({ alt_baro: 0 }), RECEIVED_AT, 'test');
    expect(observation?.onGround).toBe(false);
    expect(observation?.altFt).toBe(0);
  });

  it('falls back to geometric altitude when alt_baro is absent, without guessing ground state', () => {
    const observation = toObservation(aircraft({ alt_geom: 28250 }), RECEIVED_AT, 'test');
    expect(observation?.altFt).toBe(28250);
    expect(observation?.onGround).toBe(false);
  });
});

describe('vertical rate', () => {
  it('prefers barometric rate', () => {
    const observation = toObservation(
      aircraft({ baro_rate: 2200, geom_rate: 2100 }),
      RECEIVED_AT,
      'test',
    );
    expect(observation?.verticalRateFpm).toBe(2200);
  });

  it('falls back to geometric rate, which is often the only one present', () => {
    // Measured on real data: 9 of 52 airborne aircraft had baro_rate only, 4 had
    // geom_rate only. Requiring either field would discard most of the traffic.
    const observation = toObservation(aircraft({ geom_rate: -1152 }), RECEIVED_AT, 'test');
    expect(observation?.verticalRateFpm).toBe(-1152);
  });

  it('is null when neither is reported, rather than 0', () => {
    // 0 would mean "level flight", which is a claim we have not been given. SPEC
    // §3.2's climb and descent gates must not fire on an absent reading.
    const observation = toObservation(aircraft(), RECEIVED_AT, 'test');
    expect(observation?.verticalRateFpm).toBeNull();
  });

  it('preserves a descent as negative', () => {
    const observation = toObservation(aircraft({ baro_rate: -800 }), RECEIVED_AT, 'test');
    expect(observation?.verticalRateFpm).toBeLessThan(0);
  });
});

describe('privacy (SPEC §3.2, §3.7)', () => {
  it('discards a tail-number callsign for a private aircraft', () => {
    // The non-obvious hazard: for private aircraft the callsign IS the tail number.
    // 26 of 100 aircraft in a real response carried callsigns like N56578, N6091F,
    // N814TW. Dropping the `r` field alone would still have published all of them.
    const observation = toObservation(
      aircraft({ flight: 'N56578 ', r: 'N56578', t: 'C172' }),
      RECEIVED_AT,
      'test',
    );
    expect(observation?.identity).toBe('private');
    expect(observation?.callsign).toBeNull();
    expect(observation?.typeCode).toBe('C172'); // type IS permitted
  });

  it('keeps an airline flight number', () => {
    const observation = toObservation(aircraft({ flight: 'UAL1810 ' }), RECEIVED_AT, 'test');
    expect(observation?.identity).toBe('airline');
    expect(observation?.callsign).toBe('UAL1810');
  });

  it('never carries registration or operator onto an observation', () => {
    const observation = toObservation(
      aircraft({ flight: 'UAL1810', r: 'N12345', ownOp: 'Some Owner LLC' }),
      RECEIVED_AT,
      'test',
    );
    const serialised = JSON.stringify(observation);
    expect(serialised).not.toContain('N12345');
    expect(serialised).not.toContain('Some Owner');
  });

  it('strips identifying fields from the raw copy kept for recording', () => {
    const stripped = stripIdentifyingFields({
      hex: 'abc123',
      alt_baro: 5000,
      r: 'N99999',
      ownOp: 'Owner',
      registration: 'N99999',
      category: 'A7',
    });
    for (const field of IDENTIFYING_FIELDS) {
      expect(stripped).not.toHaveProperty(field);
    }
    // And keeps everything tuning actually needs (SPEC §3.5).
    expect(stripped).toMatchObject({ hex: 'abc123', alt_baro: 5000, category: 'A7' });
  });

  it('classifies callsigns, failing safe toward private', () => {
    for (const airline of ['UAL1810', 'DAL45', 'AAL9', 'BAW117A', 'ual1810 ']) {
      expect(classifyCallsign(airline).identity, airline).toBe('airline');
    }
    for (const notAirline of ['N56578', 'N6091F', 'N814TW', 'N955AA', '', '   ', undefined, null]) {
      expect(classifyCallsign(notAirline).identity, String(notAirline)).toBe('private');
      expect(classifyCallsign(notAirline).callsign).toBeNull();
    }
  });
});

describe('unusable entries', () => {
  it('drops an aircraft with no position', () => {
    // geo.ts propagates NaN rather than throwing, and JSON.stringify(NaN) is null,
    // so a positionless aircraft would otherwise reach the wire as
    // rel: {bearing_deg: null}. This is the boundary guard geo.ts defers to.
    expect(toObservation({ hex: 'abc123' }, RECEIVED_AT, 'test')).toBeNull();
    expect(toObservation({ hex: 'abc123', lat: 40.7 }, RECEIVED_AT, 'test')).toBeNull();
  });

  it('drops an aircraft with a non-finite position', () => {
    expect(toObservation({ hex: 'a', lat: NaN, lon: -74 }, RECEIVED_AT, 'test')).toBeNull();
    expect(toObservation({ hex: 'a', lat: 40.7, lon: Infinity }, RECEIVED_AT, 'test')).toBeNull();
  });

  it('normalises the ICAO hex so it is a stable track key', () => {
    const observation = toObservation(aircraft({ hex: ' A4460F ' }), RECEIVED_AT, 'test');
    expect(observation?.icao).toBe('a4460f');
  });
});

describe('both envelopes (SPEC §3.1 A1 and A2)', () => {
  const entry = { hex: 'abc123', lat: 40.7, lon: -74.1, alt_baro: 3000 };

  it("reads adsb.lol's `ac` array", () => {
    expect(parseAdsbResponse({ ac: [entry] }, RECEIVED_AT, 'adsb.lol').observations).toHaveLength(
      1,
    );
  });

  it("reads adsb.fi's `aircraft` array", () => {
    // Verified difference: identical per-aircraft fields, different envelope key.
    // One parser handles both, which is what makes failover a config change.
    expect(
      parseAdsbResponse({ aircraft: [entry] }, RECEIVED_AT, 'adsb.fi').observations,
    ).toHaveLength(1);
  });

  it('throws when neither key is present, rather than silently reporting no traffic', () => {
    // An empty sky and a changed API must not look the same: one is Sunday at 4am,
    // the other needs a failover.
    expect(() => parseAdsbResponse({ foo: [] }, RECEIVED_AT, 'adsb.lol')).toThrow(/neither/);
  });

  it('accepts a genuinely empty list as an empty sky', () => {
    expect(parseAdsbResponse({ ac: [] }, RECEIVED_AT, 'adsb.lol').observations).toHaveLength(0);
  });
});

describe('a real captured response', () => {
  const result = parseAdsbResponse(fixture, RECEIVED_AT, 'adsb.lol');

  it('parses every aircraft in the fixture', () => {
    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
  });

  it('survives one malformed entry without losing the poll', () => {
    // A single bad record in a 100-aircraft response must cost us that record, not
    // the whole poll.
    const withJunk = { ac: [{ hex: 'ok', lat: 40.7, lon: -74.1 }, { nonsense: true }, 42] };
    const parsed = parseAdsbResponse(withJunk, RECEIVED_AT, 'adsb.lol');
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
  });

  it('leaks no identity from the real data', () => {
    // Wrapper keys are spelled out deliberately: an earlier version used `{o, r}`
    // and the wrapper's own `"r"` key tripped the denylist check below.
    const serialised = JSON.stringify({
      observations: result.observations,
      rawForRecording: result.rawForRecording,
    });
    for (const field of IDENTIFYING_FIELDS) {
      expect(serialised).not.toContain(`"${field}"`);
    }
    // No private aircraft kept a callsign.
    for (const observation of result.observations) {
      if (observation.identity === 'private') expect(observation.callsign).toBeNull();
    }
  });

  it('includes both ground and airborne aircraft, as the real sky does', () => {
    expect(result.observations.some((o) => o.onGround)).toBe(true);
    expect(result.observations.some((o) => !o.onGround && o.altFt !== null)).toBe(true);
  });
});
