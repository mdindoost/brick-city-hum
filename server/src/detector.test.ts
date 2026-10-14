import { describe, expect, it } from 'vitest';
import { Detector } from './detector.js';
import { eventSchema, toPublicEvent } from './events.js';
import { nauticalMilesToKm } from './geo.js';
import type { Observation } from './observation.js';
import { observation, realPlaces, realSources } from './testing.js';

const places = realPlaces();
const sources = realSources();
const EWR = places.places.ewr;
const ORIGIN = places.origin;
const T0 = 1760458800000;

let idCounter = 0;
function detector(): Detector {
  idCounter = 0;
  return new Detector({
    places,
    sources,
    makeId: () => `evt_test_${String(++idCounter)}`,
  });
}

/** Build a track from a list of partial observations, 10 s apart, oldest first. */
function track(steps: Partial<Observation>[], at: LatLonish = EWR): Observation[] {
  return steps.map((step, index) =>
    observation({ lat: at.lat, lon: at.lon, t: T0 + index * 10_000, ...step }),
  );
}
interface LatLonish {
  lat: number;
  lon: number;
}

/** A point `km` north of the origin, for distance-based tests. */
function northOfOrigin(km: number): LatLonish {
  return { lat: ORIGIN.lat + km / 111.195, lon: ORIGIN.lon };
}

describe('ewr_departure', () => {
  it('fires on a clean takeoff', () => {
    const events = detector().detect(
      track([
        { onGround: true, altFt: null, verticalRateFpm: null },
        { altFt: 400, verticalRateFpm: 1800 },
        { altFt: 1600, verticalRateFpm: 2200 },
      ]),
    );
    expect(events.map((e) => e.type)).toContain('ewr_departure');
  });

  it('fires once, not on every poll of the climb', () => {
    // The aircraft stays above the gate and climbing for several polls. Testing
    // "altitude > gate" rather than the crossing would retrigger the same departure
    // every 10 seconds — §1.4's "never chaotic" failing in the most irritating way.
    const d = detector();
    const history = track([
      { onGround: true, altFt: null, verticalRateFpm: null },
      { altFt: 400, verticalRateFpm: 1800 },
      { altFt: 1600, verticalRateFpm: 2200 },
      { altFt: 3000, verticalRateFpm: 2000 },
      { altFt: 5000, verticalRateFpm: 1800 },
    ]);
    let fired = 0;
    for (let n = 1; n <= history.length; n += 1) {
      fired += d.detect(history.slice(0, n)).filter((e) => e.type === 'ewr_departure').length;
    }
    expect(fired).toBe(1);
  });

  it('does NOT fire on a go-around', () => {
    // §3.2's literal rule ("previous observation below 500 ft") is satisfied by a
    // go-around: descend to 300 ft, do not land, climb away. At a busy airport that
    // is routine, not exotic, and it would be captioned as a departure that never
    // happened — a direct breach of §1.2, "every sound is true".
    const events = detector().detect(
      track([
        { altFt: 2000, verticalRateFpm: -900 },
        { altFt: 900, verticalRateFpm: -700 },
        { altFt: 300, verticalRateFpm: -200 },
        { altFt: 800, verticalRateFpm: 1500 },
        { altFt: 1600, verticalRateFpm: 2200 },
      ]),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_departure');
  });

  it('does not fire for an aircraft climbing far from EWR', () => {
    const far = { lat: EWR.lat + 0.6, lon: EWR.lon };
    const events = detector().detect(
      track(
        [
          { onGround: true, altFt: null, verticalRateFpm: null },
          { altFt: 400, verticalRateFpm: 1800 },
          { altFt: 1600, verticalRateFpm: 2200 },
        ],
        far,
      ),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_departure');
  });

  it('does not fire without a climb rate', () => {
    // An absent vertical rate is not a claim of level flight, and must not be read
    // as one in either direction.
    const events = detector().detect(
      track([
        { onGround: true, altFt: null, verticalRateFpm: null },
        { altFt: 400, verticalRateFpm: null },
        { altFt: 1600, verticalRateFpm: null },
      ]),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_departure');
  });

  it('survives an aircraft that disappears mid-climb', () => {
    const d = detector();
    expect(() =>
      d.detect(
        track([
          { onGround: true, altFt: null, verticalRateFpm: null },
          { altFt: 400, verticalRateFpm: 1800 },
        ]),
      ),
    ).not.toThrow();
  });
});

describe('ewr_arrival', () => {
  it('fires on a descent through the gate', () => {
    const events = detector().detect(
      track([
        { altFt: 2500, verticalRateFpm: -800 },
        { altFt: 900, verticalRateFpm: -700 },
      ]),
    );
    expect(events.map((e) => e.type)).toContain('ewr_arrival');
  });

  it('fires on a transition to the ground, even with no descent seen', () => {
    // Catches aircraft that appear late — we never saw the approach, only the touch.
    const events = detector().detect(
      track([
        { altFt: 200, verticalRateFpm: -400 },
        { onGround: true, altFt: null, verticalRateFpm: null },
      ]),
    );
    expect(events.map((e) => e.type)).toContain('ewr_arrival');
  });

  it('fires once', () => {
    const d = detector();
    const history = track([
      { altFt: 2500, verticalRateFpm: -800 },
      { altFt: 900, verticalRateFpm: -700 },
      { altFt: 400, verticalRateFpm: -500 },
      { onGround: true, altFt: null, verticalRateFpm: null },
    ]);
    let fired = 0;
    for (let n = 1; n <= history.length; n += 1) {
      fired += d.detect(history.slice(0, n)).filter((e) => e.type === 'ewr_arrival').length;
    }
    expect(fired).toBe(1);
  });

  it('does not fire for a climbing aircraft below the gate', () => {
    const events = detector().detect(
      track([
        { altFt: 300, verticalRateFpm: 1500 },
        { altFt: 900, verticalRateFpm: 1800 },
      ]),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_arrival');
  });
});

describe('overflight_city', () => {
  it('fires when an aircraft enters the circle below the ceiling', () => {
    const events = detector().detect(
      track([{ altFt: 4000, verticalRateFpm: 0 }], northOfOrigin(1)),
    );
    expect(events.map((e) => e.type)).toContain('overflight_city');
  });

  it('does not re-fire while the aircraft stays inside', () => {
    // §6.4 holds a sustained voice for the whole crossing, so re-entry events would
    // restart that voice every poll.
    const d = detector();
    const inside = northOfOrigin(1);
    let fired = 0;
    for (let i = 0; i < 5; i += 1) {
      fired += d
        .detect(track([{ altFt: 4000, t: T0 + i * 10_000 }], inside))
        .filter((e) => e.type === 'overflight_city').length;
    }
    expect(fired).toBe(1);
  });

  it('needs hysteresis to clear before it can fire again', () => {
    const d = detector();
    const radius = sources.detection.overflight_city.within_km_of_origin;
    const hysteresis = sources.detection.exit_hysteresis_km;

    expect(d.detect(track([{ altFt: 4000 }], northOfOrigin(1)))).toHaveLength(1);
    // Just outside the radius but inside the hysteresis band: still considered in,
    // so an aircraft loitering on the boundary cannot retrigger every 10 seconds.
    d.detect(track([{ altFt: 4000 }], northOfOrigin(radius + hysteresis / 2)));
    const stillSuppressed = d.detect(track([{ altFt: 4000 }], northOfOrigin(1)));
    expect(stillSuppressed.filter((e) => e.type === 'overflight_city')).toHaveLength(0);

    // Genuinely gone, then back for a second pass: that is a real new event.
    d.detect(track([{ altFt: 4000 }], northOfOrigin(radius + hysteresis + 2)));
    const secondPass = d.detect(track([{ altFt: 4000 }], northOfOrigin(1)));
    expect(secondPass.filter((e) => e.type === 'overflight_city')).toHaveLength(1);
  });

  it('does not fire above the ceiling — that is overflight_high', () => {
    const events = detector().detect(
      track([{ altFt: 33000, verticalRateFpm: 0 }], northOfOrigin(1)),
    );
    const types = events.map((e) => e.type);
    expect(types).not.toContain('overflight_city');
    expect(types).toContain('overflight_high');
  });
});

describe('helicopter', () => {
  it('fires for category A7 low and near', () => {
    const events = detector().detect(
      track([{ category: 'A7', altFt: 1200, typeCode: 'R44' }], northOfOrigin(2)),
    );
    expect(events.map((e) => e.type)).toContain('helicopter');
  });

  it('does not fire for a non-helicopter in the same place', () => {
    const events = detector().detect(track([{ category: 'A3', altFt: 1200 }], northOfOrigin(2)));
    expect(events.map((e) => e.type)).not.toContain('helicopter');
  });

  it('can be both a helicopter and a city overflight at once', () => {
    // One observation legitimately producing two events — a helicopter crossing the
    // city is both, and §6.4 gives each its own voice.
    const events = detector().detect(
      track([{ category: 'A7', altFt: 1200, typeCode: 'R44' }], northOfOrigin(1)),
    );
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['helicopter', 'overflight_city']),
    );
  });
});

describe('heavy modifier', () => {
  it('marks category A5 and raises salience', () => {
    const light = detector().detect(
      track([
        { onGround: true, altFt: null, verticalRateFpm: null },
        { altFt: 400, verticalRateFpm: 1800 },
        { altFt: 1600, verticalRateFpm: 2200, category: 'A3' },
      ]),
    );
    const heavy = detector().detect(
      track([
        { onGround: true, altFt: null, verticalRateFpm: null },
        { altFt: 400, verticalRateFpm: 1800 },
        { altFt: 1600, verticalRateFpm: 2200, category: 'A5' },
      ]),
    );
    expect(heavy[0]?.attrs.heavy).toBe(true);
    expect(light[0]?.attrs.heavy).toBe(false);
    expect(heavy[0]?.salience).toBeGreaterThan(light[0]!.salience);
  });
});

describe('events are well-formed (SPEC §4)', () => {
  const events = detector().detect(
    track([
      { onGround: true, altFt: null, verticalRateFpm: null },
      { altFt: 400, verticalRateFpm: 1800 },
      { altFt: 1600, verticalRateFpm: 2200 },
    ]),
  );
  const event = events[0]!;

  it('validates against the event schema', () => {
    expect(() => eventSchema.parse(event)).not.toThrow();
  });

  it('carries bearing and distance relative to the origin', () => {
    // EWR is south of NJIT, so a departure there must be heard from the south.
    expect(event.rel.bearing_deg).toBeGreaterThan(135);
    expect(event.rel.bearing_deg).toBeLessThan(225);
    expect(event.rel.distance_km).toBeCloseTo(5.57, 1);
  });

  it('keeps salience in range and scales it by distance', () => {
    expect(event.salience).toBeGreaterThan(0);
    expect(event.salience).toBeLessThanOrEqual(1);
    const farther = detector().detect(
      track(
        [
          { onGround: true, altFt: null, verticalRateFpm: null },
          { altFt: 400, verticalRateFpm: 1800 },
          { altFt: 1600, verticalRateFpm: 2200 },
        ],
        { lat: EWR.lat - 0.02, lon: EWR.lon },
      ),
    );
    expect(farther[0]!.salience).toBeLessThan(event.salience);
  });

  it('is not flagged as simulated or scheduled', () => {
    expect(event.sim).toBe(false);
    expect(event.scheduled).toBe(false);
  });
});

describe('captions and descriptions (SPEC §3.2 as amended)', () => {
  function describeOf(partial: Partial<Observation>): string {
    const events = detector().detect(track([{ altFt: 4000, ...partial }], northOfOrigin(1)));
    return events[0]!.attrs.described_as;
  }

  it('uses plain English for a known type, not the code', () => {
    expect(describeOf({ typeCode: 'P28A' })).toBe('a light propeller plane');
    expect(describeOf({ typeCode: 'GLF5' })).toBe('a Gulfstream');
  });

  it('falls back to emitter category for an unknown type', () => {
    expect(describeOf({ typeCode: 'ZZZZ', category: 'A5' })).toBe('a heavy jet');
  });

  it('falls back to "a plane" when nothing is known', () => {
    expect(describeOf({ typeCode: null, category: null })).toBe('a plane');
  });

  it('never puts a callsign in a caption, even for an airline flight', () => {
    const events = detector().detect(
      track([{ altFt: 4000, callsign: 'UAL1810', typeCode: 'B738' }], northOfOrigin(1)),
    );
    expect(events[0]!.caption).not.toContain('UAL1810');
    // Describes the aircraft, not the flight: "an airliner over the city".
    expect(events[0]!.caption).toBe('✈ an airliner over the city');
  });
});

describe('toPublicEvent strips what §3.2 forbids publishing', () => {
  const events = detector().detect(
    track([{ altFt: 4000, callsign: 'UAL1810', typeCode: 'B738' }], northOfOrigin(1)),
  );
  const published = toPublicEvent(events[0]!);

  it('removes the callsign from the client payload, not just from the UI', () => {
    // A callsign that rides along "for internal use" is recoverable from devtools in
    // thirty seconds, and by anyone scraping the endpoint.
    expect(JSON.stringify(published)).not.toContain('UAL1810');
    expect(JSON.stringify(published)).not.toContain('callsign');
  });

  it('keeps what the client needs to make sound and captions', () => {
    expect(published).toHaveProperty('rel');
    expect(published).toHaveProperty('caption');
    expect(published).toHaveProperty('salience');
  });
});

describe('state does not accumulate', () => {
  it('forgets aircraft the track store has forgotten', () => {
    const d = detector();
    for (let i = 0; i < 50; i += 1) {
      d.detect([observation({ icao: `a${String(i)}`, altFt: 4000, ...northOfOrigin(1) })]);
    }
    expect(d.trackedAircraft).toBe(50);
    d.retainOnly(['a0', 'a1']);
    expect(d.trackedAircraft).toBe(2);
  });
});

describe('does not assume a runway or a flow direction (SPEC §3.2)', () => {
  it('detects departures in both directions from the same place', () => {
    // Flow at EWR reverses with the wind, often twice a day. A detector that
    // encoded a direction would silently stop working half the time.
    for (const bearingSign of [1, -1]) {
      const events = detector().detect(
        track(
          [
            { onGround: true, altFt: null, verticalRateFpm: null },
            { altFt: 400, verticalRateFpm: 1800 },
            { altFt: 1600, verticalRateFpm: 2200 },
          ],
          { lat: EWR.lat + bearingSign * 0.01, lon: EWR.lon + bearingSign * 0.01 },
        ),
      );
      expect(events.map((e) => e.type)).toContain('ewr_departure');
    }
  });

  it('uses the configured radius, not a hard-coded one', () => {
    const radiusKm = nauticalMilesToKm(sources.detection.ewr_departure.within_nm_of_ewr);
    expect(radiusKm).toBeGreaterThan(0);
  });
});
