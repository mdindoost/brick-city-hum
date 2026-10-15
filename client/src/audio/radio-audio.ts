/**
 * The listening side. SPEC §2.1, §2.3, §9.4.
 *
 * Three things this file exists to get right, all of them easy to get wrong:
 *
 *  1. **Audio never starts before the gesture** (§2.1). Browsers enforce this, but
 *     the reason it is also our rule is that an ambient radio that begins talking to
 *     a stranger uninvited is the opposite of the thing we are building.
 *  2. **iOS** (§2.3): `navigator.audioSession.type = 'playback'` must be set inside
 *     the handler, or the page is treated as a game and silenced by the ring switch.
 *  3. **The shared clock** (§9.4): the server's `play_at` is in server milliseconds
 *     and Tone schedules in context seconds. The conversion happens here, once, so
 *     no voice is ever tempted to read a clock of its own.
 *
 * Starting is now two stages, because the aircraft voices play samples (§6.9). The
 * Ground is synthesis and needs nothing, so it starts the instant the listener
 * presses ▶ and there is sound immediately; the 3 MB of kits load behind it and the
 * voices join when they arrive. The alternative — waiting for the download before
 * anything sounds — makes the button feel broken on a slow connection, and the
 * opposite, letting voices play before their kit exists, would mean the piece
 * silently sounded like the version that lost two listening rounds.
 */

import * as Tone from 'tone';
import type { AudioConfig, PublicEvent } from '../../../shared/protocol.js';
import { AudioEngine } from './engine.js';
import { Ground } from './ground.js';
import { loadSampleKits, type SampleKit, type SampleManifest } from './samples.js';
import { aircraftVoices, requiredInstruments } from './voices/aircraft.js';
import { RailVoice } from './voices/rail.js';
import { TapVoice } from './voices/tap.js';

/** Mobile gets half the voices (§6.8), decided once at start. */
function isMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export class RadioAudio {
  private engine: AudioEngine | null = null;
  private ground: Ground | null = null;
  private started = false;
  private loading = true;
  private sampleError: string | null = null;
  private dropped = 0;

  constructor(private readonly audio: AudioConfig) {}

  get running(): boolean {
    return this.started;
  }

  /** Events refused by the voice budget, shown in the header so it is not invisible. */
  get droppedCount(): number {
    return this.dropped;
  }

  /** True between the gesture and the kits being ready: drone only, no voices. */
  get loadingSamples(): boolean {
    return this.loading;
  }

  /** Why the kits are missing, if they are. Shown rather than swallowed. */
  get sampleFailure(): string | null {
    return this.sampleError;
  }

  /** Must be called from inside a user-gesture handler. */
  async start(): Promise<void> {
    if (this.started) return;

    // §2.3. Guarded because the API exists only on Safari; `audioSession` is not in
    // the DOM lib, so this is the one place the client reaches past its own types.
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session !== undefined) session.type = 'playback';

    await Tone.start();
    Tone.getTransport().bpm.value = this.audio.transport.bpm;

    const engine = new AudioEngine({
      maxVoices: isMobile() ? this.audio.voices.max_mobile : this.audio.voices.max_desktop,
      targetLufs: -20,
      // One seed per listening session. Everyone in a session shares it only in the
      // offline render; live, the jitter it drives is per-event and inaudible either
      // way. §6.2's shared section seed arrives with sections in Phase 2.
      sectionSeed: Math.floor(Date.now() / 60000),
      scale: this.audio.palette.scale,
      rootMidi: this.audio.palette.root_midi,
      bpm: this.audio.transport.bpm,
      master: this.audio.master,
      textureGain: this.audio.governor_texture_gain,
    });
    // The drone first, so the page is making sound before the kits have downloaded.
    // Through the engine's trim rather than straight to the destination, so §6.8's
    // true-peak ceiling covers the sum of drone and voices and not only the voices.
    const ground = new Ground(this.audio);
    ground.start(engine.groundDestination, Tone.now());
    this.ground = ground;
    this.started = true;

    const kits = await this.loadKits();
    for (const voice of aircraftVoices(this.audio, kits)) engine.register(voice);
    engine.register(new RailVoice(this.audio));
    engine.register(new TapVoice(this.audio));
    await engine.prepare({ withReverb: true });

    // Last, because `schedule` checks for it: an event that arrives while the kits
    // are still downloading is counted as dropped rather than played voiceless.
    this.engine = engine;
    this.loading = false;
  }

  /**
   * Fetch the manifest and the kits (§6.9).
   *
   * A failure here is not fatal. The manifest is a generated file rather than part
   * of the score, so a mismatch between a deployed page and its samples is a real
   * possibility, and the answer to it is a radio of drone, bells and taps — thinner
   * than intended, honest about every sound it makes, and still running.
   */
  private async loadKits(): Promise<Map<string, SampleKit>> {
    const base = this.audio.samples.base_url;
    try {
      const response = await fetch(`${base.endsWith('/') ? base : `${base}/`}manifest.json`);
      if (!response.ok) throw new Error(`manifest: HTTP ${String(response.status)}`);
      const manifest = (await response.json()) as SampleManifest;
      const kits = await loadSampleKits({ baseUrl: base, manifest });
      // A manifest that loads but lists too little is the dangerous case, because
      // nothing throws: every voice whose kit is absent is left out of the piece
      // (voices/aircraft.ts) and the radio plays on, quieter and poorer, sounding
      // like a tuning decision rather than a broken build. Say which.
      const missing = requiredInstruments(this.audio).filter((name) => !kits.has(name));
      if (missing.length > 0) {
        this.sampleError = `no samples for ${[...new Set(missing)].sort().join(', ')}`;
      }
      return kits;
    } catch (error) {
      this.sampleError = error instanceof Error ? error.message : String(error);
      return new Map();
    }
  }

  /**
   * Schedule a batch for its shared play time.
   *
   * `playAtServerMs` is the server's clock; `serverNowMs` is what the client believes
   * that clock reads at this instant. Their difference is how far ahead the event is,
   * and that is the only part either clock contributes — absolute times never meet.
   */
  schedule(events: readonly PublicEvent[], playAtServerMs: number, serverNowMs: number): void {
    const engine = this.engine;
    if (engine === null) return;
    const leadSeconds = (playAtServerMs - serverNowMs) / 1000;
    // A batch that arrived late is played now rather than in the past: scheduling
    // behind the context time throws in Tone, and a slightly late note is better
    // than a silent one (§1.4).
    const at = Tone.now() + Math.max(0.02, leadSeconds);
    for (const event of events) {
      if (!engine.schedule(event, at)) this.dropped += 1;
    }
  }

  /**
   * Follow the sky (§6.2). Called when the server says the daypart moved.
   *
   * The crossfade is long on purpose: §6.2 says transitions take 5–10 minutes and
   * never jump, and a listener who has had the page open for an hour should notice
   * the light changing, not a switch being thrown.
   */
  setDaypart(daypart: string, crossfadeSeconds = 420): void {
    const palette = this.audio.palettes[daypart];
    if (palette === undefined || this.engine === null) return;
    this.engine.setPalette({ rootMidi: palette.root_midi, scale: palette.scale });
    this.ground?.retune(
      palette.ground_cutoff_hz,
      palette.ground_gain,
      Tone.now(),
      crossfadeSeconds,
    );
  }

  /**
   * Play a tap immediately, before the server has seen it (§8).
   *
   * The person who tapped must hear themselves at once; everyone else hears it on the
   * next grid step when it comes back round. A tap that waited for a round trip would
   * feel broken even at 20 ms, and if the server refuses it under the rate limit the
   * tapper still heard their own note — which is the honest outcome, not a bug.
   */
  playLocalTap(event: PublicEvent): void {
    this.engine?.schedule(event, Tone.now() + 0.02);
  }

  stop(): void {
    this.ground?.stop(Tone.now());
    this.started = false;
  }
}
