/**
 * The listener's end of the radio. SPEC §6.3.
 *
 * Reconnects by itself with backoff, because the page is meant to be left open for
 * hours and a dropped socket must not end the piece. Backoff rather than a tight
 * retry for the same reason the collectors use it: a reconnect storm from many tabs
 * is indistinguishable from an attack (§9.1).
 */

import type { ClientMessage, ServerMessage, TapMessage } from '../../../shared/protocol.js';
import { ClockSync } from './clocksync.js';

export interface RadioHandlers {
  readonly onHello: (message: Extract<ServerMessage, { type: 'hello' }>) => void;
  readonly onEvents: (message: Extract<ServerMessage, { type: 'events' }>) => void;
  readonly onSky: (message: Extract<ServerMessage, { type: 'sky' }>) => void;
  readonly onStatus: (status: 'connecting' | 'live' | 'offline') => void;
}

const PING_EVERY_MS = 5000;
/**
 * Probes that may go unanswered before the socket is treated as dead.
 *
 * **This is what catches a half-open connection**, and nothing else does. Killing the
 * server sends a FIN and the browser fires `close`; a tunnel flap does not. The
 * connection is severed at Cloudflare's edge several hops away, the server stays up
 * and healthy, and no close frame ever reaches the browser: `readyState` stays OPEN,
 * `close` and `error` never fire, `send()` succeeds into nothing, and the page looks
 * connected while no event will ever arrive again — until the browser's own TCP
 * keepalive gives up, which can take minutes.
 *
 * Three missed probes is about 15 seconds, comfortably under the point where a
 * listener would notice the city had stopped, and it turns a half-open socket into an
 * ordinary close so the reconnect path that is already tested takes over.
 *
 * (Caught by the pishkar session, which runs a Cloudflare tunnel on this machine and
 * has five days of flap logs: 27 of its 36 reconnects were the edge draining itself.)
 */
const STALE_AFTER_PROBES = 3;
const BACKOFF_MS = [500, 1000, 2000, 5000, 10000] as const;

export class Radio {
  readonly clock = new ClockSync();
  private socket: WebSocket | null = null;
  private attempt = 0;
  private pingTimer: number | null = null;
  /** When the server last said anything at all. The watchdog's only input. */
  private lastHeardAt = 0;
  /** Bumped whenever a socket is abandoned, so its late events are ignored. */
  private generation = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: RadioHandlers,
  ) {}

  connect(): void {
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'offline');
    const generation = ++this.generation;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (generation !== this.generation) return;
      this.attempt = 0;
      this.lastHeardAt = Date.now();
      this.handlers.onStatus('live');
      this.pingTimer = window.setInterval(() => {
        if (Date.now() - this.lastHeardAt > PING_EVERY_MS * STALE_AFTER_PROBES) {
          this.abandon(generation);
          return;
        }
        this.ping();
      }, PING_EVERY_MS);
      this.ping();
    });

    socket.addEventListener('message', (raw: MessageEvent<string>) => {
      if (generation !== this.generation) return;
      const received = Date.now();
      this.lastHeardAt = received;
      let message: ServerMessage;
      try {
        message = JSON.parse(raw.data) as ServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case 'hello':
          this.clock.seed(message.server_ms, received);
          this.handlers.onHello(message);
          break;
        case 'events':
          this.handlers.onEvents(message);
          break;
        case 'sky':
          this.handlers.onSky(message);
          break;
        case 'time':
          this.clock.accept(message.client_t0, message.server_ms, received);
          break;
      }
    });

    socket.addEventListener('close', () => this.abandon(generation));
    socket.addEventListener('error', () => this.abandon(generation));
  }

  /**
   * Give up on this socket and reconnect, without waiting for it to agree.
   *
   * **The waiting is the whole point.** A half-open connection — the shape a tunnel
   * flap leaves behind — does not fire `close`, so an earlier version of this
   * watchdog called `socket.close()` and then waited for the `close` event that
   * triggers the reconnect. Measured: with the server frozen for 55 seconds, the
   * event arrived 4 ms after the server was thawed. `close()` sends a closing
   * handshake and the browser holds the event until the peer answers, which a dead
   * peer never does.
   *
   * So the reconnect is driven from here instead, and the generation counter makes it
   * idempotent: a late `close` from the abandoned socket is ignored rather than
   * starting a second connection.
   */
  private abandon(generation: number): void {
    if (generation !== this.generation) return;
    this.generation += 1;
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.handlers.onStatus('offline');
    try {
      this.socket?.close();
    } catch {
      // Already closing or already gone; the reconnect below is what matters.
    }
    this.socket = null;
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 10000;
    this.attempt += 1;
    window.setTimeout(() => this.connect(), wait);
  }

  /** Send a tap (§8). Dropped silently when offline: the tapper already heard it. */
  tap(tap: Omit<TapMessage, 'type'>): void {
    this.send({ type: 'tap', ...tap });
  }

  private ping(): void {
    this.send({ type: 'ping', t0: Date.now() });
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
