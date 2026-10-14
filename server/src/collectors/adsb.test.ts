import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseAdsbResponse,
  stripIdentifyingFields,
  toObservation,
  type RawAircraft,
} from './adsb.js';
import { classifyCallsign, observationSchema } from '../observation.js';

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

  it('strips registration and operator from the raw copy kept for recording', () => {
    const stripped = stripIdentifyingFields({
      hex: 'abc123',
      alt_baro: 5000,
      r: 'N99999',
      ownOp: 'Owner',
      registration: 'N99999',
      category: 'A7',
    });
    for (const field of ['r', 'ownOp', 'registration', 'owner', 'reg']) {
      expect(stripped).not.toHaveProperty(field);
    }
    // And keeps everything tuning actually needs (SPEC §3.5).
    expect(stripped).toMatchObject({ hex: 'abc123', alt_baro: 5000, category: 'A7' });
  });

  it('removes a tail-number callsign from the raw copy but keeps an airline one', () => {
    // THE BUG THIS TEST EXISTS FOR. An earlier version stripped `r` and then copied
    // `flight` verbatim — which, for a private aircraft, is the same string. The
    // registration went straight into the append-only recordings one field over.
    const priv = stripIdentifyingFields({ hex: 'a', flight: 'N56578  ', r: 'N56578' });
    expect(priv).not.toHaveProperty('flight');
    expect(JSON.stringify(priv)).not.toMatch(/\bN56578\b/);

    const airline = stripIdentifyingFields({ hex: 'b', flight: 'UAL1810 ', r: 'N12345' });
    // Airline flight numbers are permitted by §3.2 and needed for tuning — kept,
    // and trimmed, so no padded value can slip past a later text search.
    expect(airline['flight']).toBe('UAL1810');
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

  it('leaks no identity from captured data — checked by value, not by key', () => {
    // Value-based on purpose. The real bug was a registration reaching the
    // recordings through the `flight` key, which a key-based check waved through,
    // and a verification regex anchored on a closing quote missed because the API
    // space-pads the value ("N6091F  ").
    const serialised = JSON.stringify({
      observations: result.observations,
      rawForRecording: result.rawForRecording,
    });

    // No registration-shaped string anywhere, padded or not. Word-anchored on
    // purpose: an unanchored pattern flags the substring "N8979" inside the real
    // airline callsign MTN8979 (Mountain Air Cargo), which is not a registration.
    // The first version of this check erred the other way — it required a closing
    // quote right after the characters, which the API's space padding defeated.
    expect(serialised).not.toMatch(/\bN\d{1,5}[A-Z]{0,2}\b/);
    // No operator name.
    expect(serialised).not.toMatch(/Operator/i);
    // And the keys that may never appear at all.
    for (const field of ['r', 'ownOp', 'registration', 'owner', 'reg']) {
      expect(serialised).not.toContain(`"${field}"`);
    }
    // No private aircraft kept a callsign.
    for (const observation of result.observations) {
      if (observation.identity === 'private') expect(observation.callsign).toBeNull();
    }
  });

  it('would catch a leak if one were reintroduced', () => {
    // Guards the guard: the fixture must actually CONTAIN identity, or the test
    // above passes vacuously. An earlier fixture had no `r` on any record, so the
    // headline privacy assertion could not fail.
    const raw = JSON.stringify(fixture);
    expect(raw).toMatch(/"r":/);
    expect(raw).toMatch(/\bN\d{1,5}[A-Z]{0,2}\b/);
    expect(raw).toMatch(/ownOp/);
  });

  it('includes both ground and airborne aircraft, as the real sky does', () => {
    expect(result.observations.some((o) => o.onGround)).toBe(true);
    expect(result.observations.some((o) => !o.onGround && o.altFt !== null)).toBe(true);
  });
});

describe('schema drift must not look like an empty sky', () => {
  // The failure this guards is the worst kind: silent. Aircraft come back, none
  // parse, the poll records `ok` with zero observations, /healthz stays green, and
  // the 48-hour recording (§13) collects nothing at all.
  const driftedEntry = { hex: 'abc', lat: 40.7, lon: -74.1, gs: 'two hundred knots' };

  it('throws when aircraft are returned but none can be parsed', () => {
    expect(() => parseAdsbResponse({ ac: [driftedEntry] }, RECEIVED_AT, 'adsb.lol')).toThrow(
      /schema has probably changed/,
    );
  });

  it('still parses a response where only some entries drifted', () => {
    const mixed = { ac: [{ hex: 'ok', lat: 40.7, lon: -74.1 }, driftedEntry] };
    const parsed = parseAdsbResponse(mixed, RECEIVED_AT, 'adsb.lol');
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.total).toBe(2);
  });

  it('keeps the raw copy of entries it could not parse, so drift is diagnosable', () => {
    // An earlier version pushed the raw copy only AFTER a successful parse, so a
    // schema change could not be investigated from the recordings afterwards.
    const parsed = parseAdsbResponse(
      { ac: [{ hex: 'ok', lat: 40.7, lon: -74.1 }, driftedEntry] },
      RECEIVED_AT,
      'adsb.lol',
    );
    expect(parsed.rawForRecording).toHaveLength(2);
  });
});

describe('observation timestamps (SPEC §4: a best estimate)', () => {
  it('backdates by the reported position age', () => {
    // Live data shows seen_pos up to ~50 s on parked aircraft. Stamping every
    // aircraft with the receive time makes a stale repeat look like a fresh
    // observation at a new time, which is exactly what the track store's duplicate
    // guard is meant to recognise.
    const observation = toObservation(aircraft({ seen_pos: 38.2 }), RECEIVED_AT, 'test');
    expect(observation?.t).toBe(RECEIVED_AT - 38_200);
    expect(observation?.positionAgeS).toBe(38.2);
  });

  it('falls back to the receive time when no age is reported', () => {
    const observation = toObservation(aircraft(), RECEIVED_AT, 'test');
    expect(observation?.t).toBe(RECEIVED_AT);
    expect(observation?.positionAgeS).toBeNull();
  });

  it('never produces a timestamp in the future', () => {
    for (const age of [-5, NaN, Infinity]) {
      const observation = toObservation(aircraft({ seen_pos: age }), RECEIVED_AT, 'test');
      expect(observation?.t).toBeLessThanOrEqual(RECEIVED_AT);
    }
  });

  it("keeps the envelope clock, so our latency is distinguishable from the feed's", () => {
    const parsed = parseAdsbResponse(
      { ac: [{ hex: 'a', lat: 40.7, lon: -74.1 }], now: 1_700_000_000 },
      RECEIVED_AT,
      'adsb.lol',
    );
    expect(parsed.sourceNow).toBe(1_700_000_000);
  });
});

describe('every observation validates against its own schema', () => {
  it('parses cleanly, which is P0-3 acceptance', () => {
    // The type is derived from this schema, so this also pins that they cannot drift.
    const result = parseAdsbResponse(fixture, RECEIVED_AT, 'adsb.lol');
    for (const observation of result.observations) {
      expect(() => observationSchema.parse(observation)).not.toThrow();
    }
  });
});
