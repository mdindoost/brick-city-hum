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
  // Moments (§6.1): rare, and the piece makes room for them.
  'sunrise',
  'sunset',
  // A person (§8). The only event here that someone chose to make.
  'tap',
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
  /**
   * Present only on a tap (§8).
   *
   * `degree` is an index into the current scale, so a tap can never be a wrong note;
   * `register` chooses the instrument family. `department` is a colour and nothing
   * else — there is no identifier here and there is none on the server either.
   */
  readonly tap?: {
    readonly degree: number;
    readonly register: number;
    readonly department: string | null;
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
    /** How far forward every event voice sits against the Ground (§6.1, §6.8). */
    readonly voices_gain_db: number;
    readonly limiter_ceiling_db: number;
    readonly reverb_decay_s: number;
  };
  readonly transport: { readonly bpm: number; readonly quantize_beats: number };
  /** Palette per daypart name (§6.2). The sky message says which is current. */
  readonly palettes: Record<string, Palette>;
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
  /** Where the CC0 kits are served from (§6.9). */
  readonly samples: { readonly base_url: string };
  readonly voices: {
    readonly max_desktop: number;
    readonly max_mobile: number;
    readonly min_attack_s: number;
    readonly ewr_departure: FigureParams;
    readonly ewr_arrival: FigureParams;
    readonly overflight_city: StruckParams & {
      /** Pitch drift across the pass: the Doppler hint of §6.4, in cents. */
      readonly bend_cents: number;
    };
    readonly overflight_high: StruckParams;
    readonly helicopter: {
      readonly tremolo_hz: number;
      readonly tremolo_depth: number;
      readonly attack_s: number;
      readonly hold_s: number;
      readonly release_s: number;
      readonly gain: number;
    };
    readonly sky: StruckParams;
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
    readonly tap: {
      readonly attack_s: number;
      readonly decay_s: number;
      readonly release_s: number;
      readonly gain: number;
      readonly harmonicity: readonly number[];
      readonly modulation_index: readonly number[];
      readonly octave_offset: readonly number[];
    };
    readonly heavy: {
      readonly octave_offset: number;
      readonly release_multiplier: number;
      readonly cutoff_multiplier: number;
    };
  };
}

/**
 * A voice that plays a CC0 sample rather than an oscillator (SPEC §6.9).
 *
 * `instrument` names a kit under `samples.base_url`; `register` is the MIDI window
 * that kit is allowed to speak in, because no kit covers the two octaves the
 * altitude mapping can ask for and a sample bent too far stops sounding like its
 * instrument. The three times are a fade in, a total length and a fade out: a struck
 * sample has its own decay, so there is no envelope to shape, only a window on the
 * recording.
 */
export interface StruckParams {
  readonly instrument: string;
  /** `[lowest, highest]` MIDI note this voice may play. */
  readonly register: readonly number[];
  readonly fade_in_s: number;
  readonly max_s: number;
  readonly fade_out_s: number;
  readonly gain: number;
}

/** A two- or three-note rising or falling figure (§6.4). */
export interface FigureParams extends StruckParams {
  readonly notes: number;
  readonly step_degrees: number;
  readonly gap_beats_slow: number;
  readonly gap_beats_fast: number;
  readonly vrate_fast_fpm: number;
}

export interface Palette {
  readonly root_midi: number;
  readonly scale: readonly number[];
  readonly ground_cutoff_hz: number;
  readonly ground_gain: number;
}

/** Sun and moon, recomputed on the server (§6.2). Slow state, not an event. */
export interface SkyMessage {
  readonly type: 'sky';
  readonly daypart: string;
  readonly daypart_progress: number;
  readonly sun_altitude_deg: number;
  readonly sun_azimuth_deg: number;
  readonly moon_illumination: number;
  readonly is_daylight: boolean;
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
  /** The sky at connection time, so the page starts in the right palette. */
  readonly sky: Omit<SkyMessage, 'type'> | null;
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

export type ServerMessage = HelloMessage | EventsMessage | TimeMessage | SkyMessage;

/** A clock probe. */
export interface PingMessage {
  readonly type: 'ping';
  readonly t0: number;
}

/**
 * A tap (§8). Coordinates are normalised 0..1 from the top-left of the map, so the
 * server never learns anything about the listener's screen, let alone the listener.
 */
export interface TapMessage {
  readonly type: 'tap';
  readonly x: number;
  readonly y: number;
  readonly department: string | null;
}

export type ClientMessage = PingMessage | TapMessage;
