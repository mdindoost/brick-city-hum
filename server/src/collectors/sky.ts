/**
 * Sun and moon. SPEC §3.1 S1, §6.1, §6.2.
 *
 * The one source that cannot fail: no network, no key, no rate limit, nothing to be a
 * guest on. It is computed from the origin's coordinates and the clock, which makes it
 * the right thing to carry the piece's slowest layer — when every live feed is down
 * the radio still knows whether it is night.
 *
 * It produces **state** much more than events. §6.2 wants harmony, register and
 * brightness to follow the daypart, and that is what makes three in the morning sound
 * different from an afternoon; the two events it emits are §6.1's "moments".
 *
 * Dayparts are keyed on the sun's **altitude**, not on the clock. Newark's sunset
 * moves by nearly three hours across the year, and a palette that changed at 18:00
 * would be wrong for most of it.
 */

import * as SunCalc from 'suncalc';
import { ulid } from 'ulid';
import type { CityEvent } from '../events.js';
import type { PlacesConfig, SourcesConfig } from '../config.js';

export interface SkyState {
  /** Degrees above the horizon; negative at night. */
  readonly sunAltitudeDeg: number;
  readonly sunAzimuthDeg: number;
  /** The daypart name from config — what the palette follows. */
  readonly daypart: string;
  /**
   * 0 at the previous daypart boundary, 1 at the next.
   *
   * §6.2 says palettes crossfade over 5–10 minutes and never jump. A boundary flag
   * alone cannot express that, so the position within the band travels with it.
   */
  readonly daypartProgress: number;
  /** 0 = new moon, 1 = full. */
  readonly moonIllumination: number;
  readonly moonAltitudeDeg: number;
  readonly isDaylight: boolean;
}

/**
 * This build of suncalc returns **degrees**, not the radians the classic library
 * documented, and azimuth already measured clockwise from north. Measured rather than
 * assumed: converting a value that needed no conversion put the sun at −2362° and
 * would have left the piece in permanent night. The test beside this file pins the
 * units so a future version cannot flip them back silently.
 */

export class SkyCollector {
  private lastDaypart: string | null = null;
  private firedToday = new Set<string>();
  private lastDay: string | null = null;

  constructor(
    private readonly options: {
      readonly sources: SourcesConfig;
      readonly places: PlacesConfig;
      readonly makeId?: () => string;
    },
  ) {}

  /** The sky at a given instant. Pure: the same moment always gives the same answer. */
  state(at: number): SkyState {
    const origin = this.options.places.origin;
    const date = new Date(at);
    const sun = SunCalc.getPosition(date, origin.lat, origin.lon);
    const moon = SunCalc.getMoonPosition(date, origin.lat, origin.lon);
    const altitude = sun.altitude;

    const bands = this.options.sources.sky.dayparts;
    let index = bands.findIndex((band) => altitude < band.sun_below_deg);
    if (index === -1) index = bands.length - 1;
    const band = bands[index]!;
    const floor = index === 0 ? -90 : (bands[index - 1]?.sun_below_deg ?? -90);
    const span = band.sun_below_deg - floor;
    const progress = span === 0 ? 0 : Math.min(1, Math.max(0, (altitude - floor) / span));

    return {
      sunAltitudeDeg: Number(altitude.toFixed(2)),
      sunAzimuthDeg: Number((((sun.azimuth % 360) + 360) % 360).toFixed(2)),
      daypart: band.name,
      daypartProgress: Number(progress.toFixed(3)),
      moonIllumination: Number(SunCalc.getMoonIllumination(date).fraction.toFixed(3)),
      moonAltitudeDeg: Number(moon.altitude.toFixed(2)),
      isDaylight: altitude > -0.833,
    };
  }

  /**
   * Events for this tick.
   *
   * Sunrise and sunset fire on the crossing, once per local day, and only after the
   * first tick has established where the sun already was — otherwise a restart at
   * midday would announce a sunrise that happened hours earlier.
   */
  tick(at: number): { state: SkyState; events: CityEvent[] } {
    const state = this.state(at);
    const events: CityEvent[] = [];
    const day = new Date(at).toISOString().slice(0, 10);
    if (day !== this.lastDay) {
      this.firedToday.clear();
      this.lastDay = day;
    }

    const previous = this.lastDaypart;
    this.lastDaypart = state.daypart;
    if (previous === null) return { state, events };

    const moments = this.options.sources.sky.moments;
    const crossedUp = previous === 'twilight' && state.daypart === 'low_sun';
    const crossedDown = previous === 'low_sun' && state.daypart === 'twilight';
    if (moments.sunrise && crossedUp && !this.firedToday.has('sunrise')) {
      this.firedToday.add('sunrise');
      events.push(this.build('sunrise', at, state));
    }
    if (moments.sunset && crossedDown && !this.firedToday.has('sunset')) {
      this.firedToday.add('sunset');
      events.push(this.build('sunset', at, state));
    }
    return { state, events };
  }

  private build(type: 'sunrise' | 'sunset', at: number, state: SkyState): CityEvent {
    const origin = this.options.places.origin;
    const sources = this.options.sources;
    return {
      id: (this.options.makeId ?? ulid)(),
      t: at,
      type,
      source: 'sky',
      // The sun is not at a place in the city, so the event is placed at the listener
      // and panned by the sun's own azimuth: at sunrise it really does come from the
      // east (§1.1).
      geo: { lat: origin.lat, lon: origin.lon, alt_ft: null },
      rel: { bearing_deg: Math.round(state.sunAzimuthDeg), distance_km: 0 },
      attrs: {
        callsign: null,
        operator: null,
        category: null,
        type_code: null,
        vrate_fpm: null,
        track_deg: null,
        heavy: false,
        described_as: type === 'sunrise' ? 'the sunrise' : 'the sunset',
      },
      salience: sources.salience[type],
      tier: 'voice',
      caption: sources.captions[type],
      sim: false,
      // Computed from ephemeris rather than observed. It is as certain as anything in
      // this project, but the project's rule is that what we did not see is flagged.
      scheduled: true,
    };
  }
}
