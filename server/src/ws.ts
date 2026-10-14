/**
 * WebSocket fan-out. SPEC §6.3, §9.1.
 *
 * One poll of a third-party API, one detection pass, one message to every listener.
 * Clients never call a source themselves: that is what keeps us inside the rate
 * limits of services we are a guest on, and it is also the only way every listener
 * can be hearing the same piece at the same moment.
 *
 * What crosses this boundary is `PublicEvent` and nothing else. The callsign exists
 * server-side for track keying and provenance and is stripped here (§3.2) — a field
 * that rides along "for internal use" is readable in devtools.
 *
 * No listener is identified, counted individually, or stored. The only number we keep
 * is how many sockets are open, which §3.7 permits as an aggregate.
 */

import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { toPublicEvent, type CityEvent } from './events.js';
import type { EventsMessage, HelloMessage, VisualConfig } from '../../shared/protocol.js';
import { playAt, timeReply } from './clock.js';

export interface HubOptions {
  readonly server: Server;
  readonly path?: string;
  readonly origin: HelloMessage['origin'];
  readonly visual: VisualConfig;
  readonly playLeadMs: number;
  readonly replay: boolean;
  readonly replaySpeed: number | null;
}

export class Hub {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly options: HubOptions) {
    this.wss = new WebSocketServer({ server: options.server, path: options.path ?? '/ws' });
    this.wss.on('connection', (socket) => {
      this.sockets.add(socket);
      this.send(socket, this.hello());
      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        // `ws` hands over a Buffer, an ArrayBuffer or a list of fragments depending
        // on how the frame arrived; only the first is text we can read directly.
        if (!Buffer.isBuffer(raw)) return;
        this.onMessage(socket, raw.toString('utf8'));
      });
      socket.on('close', () => this.sockets.delete(socket));
      // A socket error is the connection's problem, not the radio's: drop it quietly
      // and keep playing for everyone else (§1.4 — never silent).
      socket.on('error', () => {
        socket.close();
        this.sockets.delete(socket);
      });
    });
  }

  get listeners(): number {
    return this.sockets.size;
  }

  /** Stamp events with a shared play time and send them to everyone. */
  broadcast(events: readonly CityEvent[], nowMs: number = Date.now()): void {
    if (events.length === 0) return;
    const message: EventsMessage = {
      type: 'events',
      play_at: playAt(nowMs, this.options.playLeadMs),
      events: events.map(toPublicEvent),
    };
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  close(): void {
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    this.wss.close();
  }

  private hello(): HelloMessage {
    return {
      type: 'hello',
      server_ms: Date.now(),
      origin: this.options.origin,
      visual: this.options.visual,
      replay: this.options.replay,
      replay_speed: this.options.replaySpeed,
      listeners: this.sockets.size,
    };
  }

  private onMessage(socket: WebSocket, raw: string): void {
    // The only thing a client may ask for is the time. Anything else is ignored
    // rather than answered: this socket is a one-way radio with a clock on it.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === 'ping' &&
      typeof (parsed as { t0?: unknown }).t0 === 'number'
    ) {
      this.send(socket, timeReply((parsed as { t0: number }).t0, Date.now()));
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
