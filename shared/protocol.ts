/**
 * The contract between the server and the browser. SPEC §5.1, §6.3.
 *
 * It lives in `shared/` because both sides must agree on it exactly, and because
 * **what is absent here is a privacy decision, not an oversight**: there is no
 * callsign and no tail number in `PublicEvent`, and no field describing a listener in
 * either direction (§3.2, §3.7). A reviewer should be able to read this one file and
 * see everything that crosses the wire.
 *
 * The server's `toPublicEvent` is the only thing allowed to build a `PublicEvent`, and
 * it is written as an allow-list so that adding a sensitive field to the internal
 * event cannot start publishing it by accident.
 */

export const EVENT_TYPES = [
  'ewr_departure',
  'ewr_arrival',
  'overflight_city',
  'overflight_high',
  'helicopter',
  // A ring crossing: an aircraft coming in from the horizon (§6.5). One type for
  // every ring — distance already makes a far crossing quiet, dark and wet, so the
  // same event is texture at 30 km and the subject at 5 km without a second rule.
  'sky',
  // Crossing an altitude threshold, either way (§6.5). Climbing through ten thousand
  // feet is a real moment in a flight, and it is one the data reports precisely.
  'altitude_band',
  // Rail (§3.3). A train is not an aircraft and must not borrow its voice: §6.4 gives
  // each line a struck bell against the aircraft's sustained tones.
  'path_approaching',
  'path_arrival',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface PublicEvent {
  readonly id: string;
  /** Server epoch ms when the event happened. */
  readonly t: number;
  readonly type: EventType;
  readonly geo: { readonly lat: number; readonly lon: number; readonly alt_ft: number | null };
  /** From the listener's position at NJIT. Drives pan, gain and where the glyph sits. */
  readonly rel: { readonly bearing_deg: number; readonly distance_km: number };
  readonly attrs: {
    readonly category: string | null;
    readonly heavy: boolean;
    readonly described_as: string;
    /** Scheduled airline only, or null. Never a private operator (§3.2). */
    readonly operator: string | null;
    readonly vrate_fpm: number | null;
    /** Ground track in degrees, or null: where the aircraft is actually going. */
    readonly track_deg: number | null;
  };
  /** 0..1 — the density governor's priority (§6.5). */
  readonly salience: number;
  readonly caption: string;
  /**
   * How the governor placed this event (§6.5).
   *
   * `texture` is not a quieter kind of event — it is the same event, demoted because
   * the city was busier than the comfortable band. It still happened and it is still
   * drawn and captioned; it is simply not competing for the foreground.
   */
  readonly tier: 'voice' | 'texture';
  /** True for simulated or replayed events, which are captioned as such (§1.2). */
  readonly sim: boolean;
  readonly scheduled: boolean;
}

/** Numbers the page draws with. Mirrors `score.yaml`'s `visual:` block. */
export interface VisualConfig {
  readonly horizon_km: number;
  readonly rings_km: readonly number[];
  readonly event_life_s: number;
  readonly arrival_grow_s: number;
  readonly caption_lines: number;
  readonly caption_life_s: number;
}

/**
 * The sounding half of `score.yaml`, shipped to the browser.
 *
 * The client holds no tuning value of its own (SPEC §1.5): a number the music
 * director cannot reach from config is a number that will never be tuned, and this
 * aesthetic is tuned forever after launch.
 */
export interface AudioConfig {
  /** What the governor's demoted events are played at, relative to their voice. */
  readonly governor_texture_gain: number;
  readonly master: {
    readonly gain_db: number;
    readonly high_shelf_hz: number;
    readonly high_shelf_db: number;
    readonly compressor_threshold_db: number;
    readonly compressor_ratio: number;
    readonly compressor_attack_s: number;
    readonly compressor_release_s: number;
    readonly limiter_ceiling_db: number;
    readonly reverb_decay_s: number;
  };
  readonly transport: { readonly bpm: number; readonly quantize_beats: number };
  readonly palette: {
    readonly name: string;
    readonly root_midi: number;
    readonly scale: readonly number[];
  };
  readonly ground: {
    readonly midi: readonly number[];
    readonly gain: number;
    readonly attack_s: number;
    readonly loop_s: readonly number[];
    readonly lfo_s: readonly number[];
    readonly cutoff_hz: number;
    readonly cutoff_sweep_hz: number;
  };
  readonly voices: {
    readonly max_desktop: number;
    readonly max_mobile: number;
    readonly min_attack_s: number;
    readonly ewr_departure: FigureParams;
    readonly ewr_arrival: FigureParams;
    readonly overflight_city: {
      readonly attack_s: number;
      readonly hold_s: number;
      readonly release_s: number;
      readonly detune_cents: number;
      readonly bend_cents: number;
      readonly gain: number;
    };
    readonly overflight_high: {
      readonly attack_s: number;
      readonly release_s: number;
      readonly gain: number;
      readonly octave_offset: number;
    };
    readonly helicopter: {
      readonly tremolo_hz: number;
      readonly tremolo_depth: number;
      readonly attack_s: number;
      readonly hold_s: number;
      readonly release_s: number;
      readonly gain: number;
    };
    readonly sky: {
      readonly attack_s: number;
      readonly release_s: number;
      readonly gain: number;
    };
    readonly path: {
      readonly harmonicity: number;
      readonly modulation_index: number;
      readonly attack_s: number;
      readonly decay_s: number;
      readonly release_s: number;
      readonly approach_octave: number;
      readonly approach_gain: number;
      readonly arrival_gain: number;
    };
    readonly heavy: {
      readonly octave_offset: number;
      readonly release_multiplier: number;
      readonly cutoff_multiplier: number;
    };
  };
}

/** A two- or three-note rising or falling figure (§6.4). */
export interface FigureParams {
  readonly notes: number;
  readonly step_degrees: number;
  readonly attack_s: number;
  readonly release_s: number;
  readonly gap_beats_slow: number;
  readonly gap_beats_fast: number;
  readonly vrate_fast_fpm: number;
  readonly gain: number;
}

export interface HelloMessage {
  readonly type: 'hello';
  readonly server_ms: number;
  readonly origin: { readonly lat: number; readonly lon: number; readonly name: string };
  readonly visual: VisualConfig;
  readonly audio: AudioConfig;
  /** True when these events are a recording being replayed. The page must say so. */
  readonly replay: boolean;
  /**
   * Replay speed, or null when live. Stated rather than hidden: a recording played
   * faster than it happened misrepresents how busy the city is, and §1.2 does not
   * allow the page to be quietly wrong about that.
   */
  readonly replay_speed: number | null;
  readonly listeners: number;
}

export interface EventsMessage {
  readonly type: 'events';
  /** Server clock at which every listener renders and plays these (§9.4). */
  readonly play_at: number;
  readonly events: readonly PublicEvent[];
}

export interface TimeMessage {
  readonly type: 'time';
  /** Echoed verbatim from the client's probe, so it can subtract its own round trip. */
  readonly client_t0: number;
  readonly server_ms: number;
}

export type ServerMessage = HelloMessage | EventsMessage | TimeMessage;

/** The only thing a client may send: a clock probe. */
export interface PingMessage {
  readonly type: 'ping';
  readonly t0: number;
}

export type ClientMessage = PingMessage;
