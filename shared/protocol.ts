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
  };
  /** 0..1 — the density governor's priority (§6.5). */
  readonly salience: number;
  readonly caption: string;
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

export interface HelloMessage {
  readonly type: 'hello';
  readonly server_ms: number;
  readonly origin: { readonly lat: number; readonly lon: number; readonly name: string };
  readonly visual: VisualConfig;
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
