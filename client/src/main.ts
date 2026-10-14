/**
 * Brick City Hum — client entry point.
 *
 * Phase 1: the picture, the shared clock and the first voices.
 *
 * §2.1 governs the order of everything here: the page draws immediately and is
 * useful in silence, and audio begins only when the listener presses ▶. Events are
 * scheduled against the server's `play_at` rather than their arrival time, so the
 * glyph and the note happen together and two browsers agree.
 */

import { Radio } from './net/socket.js';
import { RadioAudio } from './audio/radio-audio.js';
import { CityMap } from './visual/map.js';
import { Captions } from './visual/captions.js';
import type { AudioConfig, PublicEvent, VisualConfig } from '../../shared/protocol.js';

interface Pending {
  readonly playAt: number;
  readonly events: readonly PublicEvent[];
}

function text(selector: string, value: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el !== null) el.textContent = value;
}

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#map');
  const ticker = document.querySelector<HTMLElement>('#captions');
  if (canvas === null || ticker === null) return;

  // A placeholder until `hello` arrives; the server owns these numbers (§1.5).
  let visual: VisualConfig = {
    horizon_km: 40,
    rings_km: [5, 10, 20, 40],
    event_life_s: 50,
    arrival_grow_s: 1.2,
    caption_lines: 8,
    caption_life_s: 120,
  };
  const map = new CityMap(canvas, visual);
  const captions = new Captions(ticker, visual);
  const pending: Pending[] = [];
  let seen = 0;
  let audio: RadioAudio | null = null;
  let audioConfig: AudioConfig | null = null;

  // §2.1: audio never starts before the listener's gesture, and the button is the
  // only thing that may start it.
  const play = document.querySelector<HTMLButtonElement>('#play');
  play?.addEventListener('click', () => {
    void (async () => {
      if (audioConfig === null) return;
      if (audio === null) audio = new RadioAudio(audioConfig);
      if (audio.running) {
        audio.stop();
        audio = null;
        play.textContent = '▶ listen';
        play.setAttribute('aria-pressed', 'false');
        return;
      }
      play.disabled = true;
      await audio.start();
      play.disabled = false;
      play.textContent = '■ stop';
      play.setAttribute('aria-pressed', 'true');
    })();
  });

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const radio = new Radio(url, {
    onHello: (hello) => {
      visual = hello.visual;
      audioConfig = hello.audio;
      map.configure(visual);
      captions.configure(visual);
      if (play !== null) play.disabled = false;
      text('#origin', hello.origin.name);
      const speed = hello.replay_speed;
      const rate = speed !== null && speed !== 1 ? ` · ${String(speed)}×` : '';
      text('#mode', hello.replay ? `replay of a real recording${rate} — not live` : 'live');
      document.body.classList.toggle('is-replay', hello.replay);
    },
    onEvents: (message) => {
      pending.push({ playAt: message.play_at, events: message.events });
    },
    onStatus: (status) => {
      text('#status', status);
      document.body.dataset.status = status;
    },
  });
  radio.connect();

  // One loop, driven by the shared clock. An event becomes visible at its `play_at`
  // and not when its packet happened to arrive, which is what keeps two browsers in
  // step (§9.4) — and is the same mechanism the voices will use.
  const frame = (): void => {
    const serverNow = radio.clock.serverNow();
    while (pending.length > 0 && pending[0]!.playAt <= serverNow) {
      const due = pending.shift()!;
      map.add(due.events, due.playAt);
      captions.add(due.events, serverNow);
      audio?.schedule(due.events, due.playAt, serverNow);
      seen += due.events.length;
    }
    map.render(serverNow);
    captions.trim(serverNow);
    const rtt = radio.clock.roundTripMs;
    text('#clock', rtt === null ? 'syncing…' : `±${String(Math.round(rtt / 2))} ms`);
    text('#count', `${String(seen)} events`);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
