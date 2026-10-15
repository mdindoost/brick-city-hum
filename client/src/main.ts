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

/**
 * The tap the tapper hears, built locally so it does not wait for a round trip.
 *
 * Deliberately the same arithmetic as the server's (`server/src/taps.ts`), because
 * the two must agree: the tapper hears this one and everyone else hears the server's,
 * and a listener comparing them in the same room would notice a different note.
 */
function localTap(x: number, y: number, department: string | null, now: number): PublicEvent {
  const degree = Math.round(x * 9) - 4;
  const register = y < 0.34 ? 2 : y < 0.67 ? 1 : 0;
  const bearing = ((Math.atan2(x - 0.5, 0.5 - y) * 180) / Math.PI + 360) % 360;
  const spread = Math.hypot(x - 0.5, y - 0.5) * 2;
  return {
    id: `local_${String(now)}`,
    t: now,
    type: 'tap',
    geo: { lat: 0, lon: 0, alt_ft: null },
    rel: { bearing_deg: Number(bearing.toFixed(0)), distance_km: Number((spread * 2).toFixed(2)) },
    attrs: {
      category: null,
      heavy: false,
      described_as: 'a listener',
      operator: null,
      vrate_fpm: null,
      track_deg: null,
    },
    tap: { degree, register, department },
    salience: 0.8,
    tier: 'voice',
    caption: '',
    sim: false,
    scheduled: false,
  };
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
  // The palette follows the sky, so a listener who presses play an hour later starts
  // in the right one rather than in whatever the file happened to ship with.
  let daypart: string | null = null;

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
      if (daypart !== null) audio.setDaypart(daypart, 0);
      play.disabled = false;
      play.textContent = '■ stop';
      play.setAttribute('aria-pressed', 'true');
    })();
  });

  // §8: tapping the map is the only thing a listener can do, and it needs no login.
  // The department is a colour, kept in localStorage and never sent anywhere else.
  let department: string | null = null;
  try {
    department = localStorage.getItem('bch.department');
  } catch {
    // Private windows and blocked storage are ordinary; the tap works without it.
  }

  canvas.addEventListener('pointerdown', (pointer: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    const x = (pointer.clientX - box.left) / box.width;
    const y = (pointer.clientY - box.top) / box.height;
    radio.tap({ x, y, department });
    // Heard at once, before the server has seen it. See `playLocalTap`.
    if (audio !== null && audioConfig !== null) {
      audio.playLocalTap(localTap(x, y, department, radio.clock.serverNow()));
    }
  });

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const radio = new Radio(url, {
    onHello: (hello) => {
      // Three lines on a phone, not eight: measured at 390 px, eight captions wrapped
      // to two lines each and covered half the map.
      visual = window.innerWidth <= 640 ? { ...hello.visual, caption_lines: 3 } : hello.visual;
      // Version skew is the normal case, not an edge case: a server restarted with a
      // new protocol while a page sits open for hours, or — as happened on
      // 2026-10-14 — a page rebuilt against a server that was started before the
      // field existed. Reading straight through produced an uncaught TypeError and a
      // button that looked fine and did nothing. The page stays useful in silence.
      // `audio` is typed as present; an older server simply does not send it.
      const sent = (hello as { audio?: AudioConfig }).audio;
      audioConfig = sent?.transport === undefined ? null : sent;
      map.configure(visual);
      captions.configure(visual);
      if (hello.sky !== null) {
        daypart = hello.sky.daypart;
        text('#daypart', hello.sky.daypart.replace('_', ' '));
      }
      if (play !== null) {
        play.disabled = audioConfig === null;
        play.title = audioConfig === null ? 'the server sent no score — restart it' : '';
      }
      text('#origin', hello.origin.name);
      const speed = hello.replay_speed;
      const rate = speed !== null && speed !== 1 ? ` · ${String(speed)}×` : '';
      text('#mode', hello.replay ? `replay of a real recording${rate} — not live` : 'live');
      document.body.classList.toggle('is-replay', hello.replay);
    },
    onEvents: (message) => {
      pending.push({ playAt: message.play_at, events: message.events });
    },
    onSky: (message) => {
      daypart = message.daypart;
      audio?.setDaypart(message.daypart);
      text('#daypart', message.daypart.replace('_', ' '));
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
