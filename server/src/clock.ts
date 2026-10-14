/**
 * The shared clock. SPEC §9.4.
 *
 * Two listeners on opposite sides of the city must hear the same note at the same
 * moment, so nothing audible is ever scheduled from local wall time. The server
 * stamps every event with `play_at` in **server** milliseconds, and each client maps
 * that into its own audio context using an offset it measures.
 *
 * The lead has to be long enough to cover the slowest reasonable connection and short
 * enough that the radio does not feel late; it is config, not code.
 */

/** When an event detected now should be played by everyone. */
export function playAt(nowMs: number, leadMs: number): number {
  return nowMs + leadMs;
}

/**
 * A reply to a client's time probe.
 *
 * The client sends the moment it asked; we echo it back beside our own clock, so the
 * client can subtract its own round trip. We never see the client's clock, which is
 * the point — nothing about a listener is learned or stored (§3.7).
 */
export interface TimeReply {
  readonly type: 'time';
  /** Echoed verbatim: the client's own timestamp from when it asked. */
  readonly client_t0: number;
  /** Server clock when the probe was answered. */
  readonly server_ms: number;
}

export function timeReply(clientT0: number, nowMs: number): TimeReply {
  return { type: 'time', client_t0: clientT0, server_ms: nowMs };
}
