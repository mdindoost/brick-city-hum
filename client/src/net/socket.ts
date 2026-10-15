/**
 * The listener's end of the radio. SPEC §6.3.
 *
 * Reconnects by itself with backoff, because the page is meant to be left open for
 * hours and a dropped socket must not end the piece. Backoff rather than a tight
 * retry for the same reason the collectors use it: a reconnect storm from many tabs
 * is indistinguishable from an attack (§9.1).
 */

import type { ClientMessage, ServerMessage } from '../../../shared/protocol.js';
import { ClockSync } from './clocksync.js';

export interface RadioHandlers {
  readonly onHello: (message: Extract<ServerMessage, { type: 'hello' }>) => void;
  readonly onEvents: (message: Extract<ServerMessage, { type: 'events' }>) => void;
  readonly onSky: (message: Extract<ServerMessage, { type: 'sky' }>) => void;
  readonly onStatus: (status: 'connecting' | 'live' | 'offline') => void;
}

const PING_EVERY_MS = 5000;
const BACKOFF_MS = [500, 1000, 2000, 5000, 10000] as const;

export class Radio {
  readonly clock = new ClockSync();
  private socket: WebSocket | null = null;
  private attempt = 0;
  private pingTimer: number | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: RadioHandlers,
  ) {}

  connect(): void {
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'offline');
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.handlers.onStatus('live');
      this.pingTimer = window.setInterval(() => this.ping(), PING_EVERY_MS);
      this.ping();
    });

    socket.addEventListener('message', (raw: MessageEvent<string>) => {
      const received = Date.now();
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

    const retry = (): void => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.handlers.onStatus('offline');
      const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 10000;
      this.attempt += 1;
      window.setTimeout(() => this.connect(), wait);
    };
    socket.addEventListener('close', retry);
    socket.addEventListener('error', () => socket.close());
  }

  private ping(): void {
    this.send({ type: 'ping', t0: Date.now() });
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
