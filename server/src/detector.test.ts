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

  it('does NOT fire on a go-around even with one spurious ground flag', () => {
    // The guard this replaces accepted on `track.some(o => o.onGround)` BEFORE
    // checking for a descent, so a single bad flag — common in real data — let a
    // go-around through as a departure. Sustained ground contact is now required.
    const events = detector().detect(
      track([
        { altFt: 2000, verticalRateFpm: -900 },
        { altFt: 900, verticalRateFpm: -700 },
        { onGround: true, altFt: null, verticalRateFpm: -200 },
        { altFt: 800, verticalRateFpm: 1500 },
        { altFt: 1600, verticalRateFpm: 2200 },
      ]),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_departure');
  });

  it('DOES fire for a slow climber whose ground segment has aged out of the window', () => {
    // The previous guard rejected this real departure: a continuous climb with no
    // ground observation left in the window and no descent anywhere. A 500–700 ft/min
    // climber takes 2–3 minutes to reach 1,500 ft and the window's median span is
    // ~132 s, so this is ordinary light-aircraft and reduced-thrust traffic, not an
    // edge case. Measured: 0 of 17 real departures used the branch meant to serve it.
    const events = detector().detect(
      track([
        { altFt: 350, verticalRateFpm: 600 },
        { altFt: 475, verticalRateFpm: 600 },
        { altFt: 600, verticalRateFpm: 600 },
        { altFt: 775, verticalRateFpm: 600 },
        { altFt: 950, verticalRateFpm: 600 },
        { altFt: 1125, verticalRateFpm: 600 },
        { altFt: 1300, verticalRateFpm: 600 },
        { altFt: 1450, verticalRateFpm: 600 },
        { altFt: 1600, verticalRateFpm: 600 },
      ]),
    );
    expect(events.map((e) => e.type)).toContain('ewr_departure');
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
    // Note the ground speed: a landed aircraft has slowed down, and the corroboration
    // check below depends on that being realistic.
    const events = detector().detect(
      track([
        { altFt: 200, verticalRateFpm: -400, groundSpeedKt: 140 },
        { onGround: true, altFt: null, verticalRateFpm: null, groundSpeedKt: 25 },
      ]),
    );
    expect(events.map((e) => e.type)).toContain('ewr_arrival');
  });

  it('does NOT fire for a climbing aircraft that reports a spurious ground flag', () => {
    // This happened in production and is on disk: a Sikorsky S-76 0.73 nm from EWR,
    // climbing at +896 ft/min, was captioned "✈ a helicopter arriving at Newark".
    // Low helicopters report alt_baro: "ground" spuriously — 190 of 285 aircraft
    // flipped at least once in 38 minutes of live data. A §1.2 breach written to an
    // append-only recording.
    const events = detector().detect(
      track([
        { altFt: 500, verticalRateFpm: 900, groundSpeedKt: 60, category: 'A7' },
        { onGround: true, altFt: null, verticalRateFpm: 896, groundSpeedKt: 60, category: 'A7' },
      ]),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_arrival');
  });

  it('does NOT fire for a fast aircraft that reports a spurious ground flag', () => {
    const events = detector().detect(
      track([
        { altFt: 800, verticalRateFpm: -100, groundSpeedKt: 210 },
        { onGround: true, altFt: null, verticalRateFpm: null, groundSpeedKt: 210 },
      ]),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_arrival');
  });

  it('does not fire for an aircraft landing far from EWR', () => {
    // Without a geographic check the rule would caption a Teterboro or JFK approach
    // as "arriving at Newark". The departure rule has had this test; the arrival rule
    // did not, and a mutation deleting its distance check survived the whole suite.
    const far = { lat: EWR.lat + 0.3, lon: EWR.lon + 0.3 };
    const events = detector().detect(
      track(
        [
          { altFt: 2500, verticalRateFpm: -800 },
          { altFt: 900, verticalRateFpm: -700 },
        ],
        far,
      ),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_arrival');
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

  it('does not also fire overflight_high when climbing through the ceiling on one pass', () => {
    // Ordinary for a departure over Newark: enter the circle below 10,000 ft and
    // climb through it while still inside. That is one pass and one voice, not two
    // captions — "over the city" followed by "high above Newark" for one aircraft.
    const d = detector();
    const over = northOfOrigin(1);
    const types: string[] = [];
    for (const altFt of [8000, 9500, 10200, 11000]) {
      types.push(...d.detect(track([{ altFt }], over)).map((e) => e.type));
    }
    expect(types).toEqual(['overflight_city']);
  });

  it('clears zone state when the aircraft lands, so a based aircraft is not silenced forever', () => {
    // The exit test used to check distance only, while entry required distance AND
    // altitude. An aircraft that stopped qualifying on altitude inside the radius was
    // stranded "inside" permanently — and its track never expires while it keeps
    // transmitting. Live data shows parked aircraft 3.3 km from the origin, well
    // inside the 5 km helicopter zone, so a based helicopter went silent after its
    // first crossing.
    const d = detector();
    const spot = northOfOrigin(2);
    expect(
      d.detect(track([{ category: 'A7', altFt: 1200, typeCode: 'R44' }], spot)).map((e) => e.type),
    ).toContain('helicopter');

    // Parks and keeps transmitting.
    for (let i = 0; i < 5; i += 1) {
      d.detect(track([{ category: 'A7', onGround: true, altFt: null, groundSpeedKt: 0 }], spot));
    }

    // Flies again from the same place: a real new crossing.
    expect(
      d.detect(track([{ category: 'A7', altFt: 1200, typeCode: 'R44' }], spot)).map((e) => e.type),
    ).toContain('helicopter');
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

  it('fires for a rotorcraft type code whose emitter category is missing', () => {
    // Found by the P0-8 validation table on real data: a Bell 407 crossing the city
    // reported emitter category D0 — "reserved", i.e. no category — so it produced
    // no helicopter event and was captioned "✈ a plane over the city".
    const events = detector().detect(
      track([{ category: 'D0', altFt: 800, typeCode: 'B407' }], northOfOrigin(2)),
    );
    expect(events.map((e) => e.type)).toContain('helicopter');
    const heli = events.find((e) => e.type === 'helicopter')!;
    expect(heli.attrs.described_as).toBe('a helicopter');
    expect(heli.caption.startsWith('🚁')).toBe(true);
  });

  it('describes a rotorcraft with no category as a helicopter, not a plane', () => {
    // The caption side of the same defect: every type code in the helicopter
    // detection list must also resolve to a helicopter in the vocabulary, or the
    // event fires with the wrong words.
    const vocabulary = sources.aircraft_vocabulary.by_type;
    for (const code of sources.detection.helicopter.type_codes) {
      expect(vocabulary[code], `${code} is missing from aircraft_vocabulary.by_type`).toMatch(
        /helicopter/,
      );
    }
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

describe('private aircraft are not described as airliners', () => {
  function describeOf(partial: Partial<Observation>): string {
    const events = detector().detect(track([{ altFt: 4000, ...partial }], northOfOrigin(1)));
    return events[0]!.attrs.described_as;
  }

  it('calls a large private jet what it is, not "an airliner"', () => {
    // Measured in live data: two Bombardier Global Express (GLEX), neither with an
    // airline callsign, both emitter category A3 — both described as "an airliner".
    // `identity` existed for exactly this decision and was being ignored.
    expect(
      describeOf({ identity: 'private', callsign: null, category: 'A3', typeCode: 'GLEX' }),
    ).toBe('a large private jet');
  });

  it('still calls a real airliner an airliner', () => {
    expect(describeOf({ identity: 'airline', callsign: 'UAL1810', category: 'A3' })).toBe(
      'an airliner',
    );
  });

  it('prefers a known type code over either category table', () => {
    expect(describeOf({ identity: 'private', category: 'A3', typeCode: 'GLF5' })).toBe(
      'a Gulfstream',
    );
  });
});

describe('captions come from config, not from code', () => {
  it('uses the configured template and place name', () => {
    const events = detector().detect(
      track([{ category: 'A7', altFt: 1200, typeCode: 'R44' }], northOfOrigin(2)),
    );
    const helicopterEvent = events.find((e) => e.type === 'helicopter')!;
    // A helicopter must not get the ✈ glyph — "✈ a helicopter arriving at Newark"
    // appeared in the real recordings.
    expect(helicopterEvent.caption.startsWith('🚁')).toBe(true);
    expect(helicopterEvent.caption).toContain(sources.captions.place);
  });

  it('renders every event type from its template without leaving a placeholder', () => {
    for (const template of Object.values(sources.captions)) {
      expect(template).not.toMatch(/\{(?!aircraft|place)\w+\}/);
    }
  });
});

describe('an arrival must be AT Newark, not merely near it', () => {
  it('does not caption a touchdown at a nearby heliport as arriving at Newark', () => {
    // Found by the P0-8 validation table on real data: a helicopter landing at
    // 40.7304, -74.1169 — a Jersey City heliport about 3.2 nm from EWR, inside the
    // 6 nm approach gate — was captioned "a small helicopter arriving at Newark".
    // §1.2: every sound is true.
    const heliport = { lat: 40.7304, lon: -74.1169 };
    const events = detector().detect(
      track(
        [
          { altFt: 300, verticalRateFpm: -320, groundSpeedKt: 40, category: 'A7' },
          { onGround: true, altFt: null, verticalRateFpm: null, groundSpeedKt: 2, category: 'A7' },
        ],
        heliport,
      ),
    );
    expect(events.map((e) => e.type)).not.toContain('ewr_arrival');
  });

  it('still catches a touchdown on the airport itself', () => {
    const events = detector().detect(
      track([
        { altFt: 200, verticalRateFpm: -400, groundSpeedKt: 130 },
        { onGround: true, altFt: null, verticalRateFpm: null, groundSpeedKt: 30 },
      ]),
    );
    expect(events.map((e) => e.type)).toContain('ewr_arrival');
  });

  it('still catches an approach descending through the gate further out', () => {
    // The wider 6 nm gate is correct for an approach — the aircraft is on its way in
    // and audibly so. Only the touchdown branch is tightened.
    const approach = { lat: EWR.lat + 0.07, lon: EWR.lon };
    const events = detector().detect(
      track(
        [
          { altFt: 2500, verticalRateFpm: -800 },
          { altFt: 900, verticalRateFpm: -700 },
        ],
        approach,
      ),
    );
    expect(events.map((e) => e.type)).toContain('ewr_arrival');
  });
});
