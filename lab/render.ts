/**
 * Offline renderer. SPEC §7.3 step 2.
 *
 * Replays a recorded slice through the real client audio engine inside headless
 * Chromium, using `Tone.Offline`, and writes a WAV. Chromium rather than a Node Web
 * Audio shim on purpose: the lab must measure what listeners actually hear, and a
 * different audio implementation would measure something else.
 *
 * **Determinism is the hard part, not ffmpeg.** Two traps, both found the hard way:
 *
 *  - `Tone.Reverb` builds its impulse response from noise generated with
 *    `Math.random`, so any render including it differs run to run. The deterministic
 *    preset omits reverb entirely; a preset that wants reverb is explicitly marked
 *    non-reproducible.
 *  - Anything reading the wall clock (`Date.now`, `performance.now`) leaks real time
 *    into the output. The page overrides `Math.random` with the seeded PRNG **before
 *    Tone is imported**, because the reverb's IR is generated at construction.
 *
 * Usage:
 *   npx tsx lab/render.ts --minutes 10 --seed demo --preset deterministic
 *   npx tsx lab/render.ts --events data/recordings/2026-10-14-event.ndjson.gz
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { readRecording } from '../server/src/recorder.js';
import { loadScore, type ScoreConfig } from '../server/src/config.js';
import { Spreader } from '../server/src/spreader.js';
import { seedFromString } from '../shared/random.js';

export interface RenderOptions {
  /** Recorded event file to replay. */
  readonly eventsPath: string;
  readonly minutes: number;
  readonly seed: string;
  /** `deterministic` omits reverb so the render is bit-identical. */
  readonly preset: 'deterministic' | 'with-reverb';
  /** `probe` is the Phase 0 regression fixture; `aircraft` is the real §6.4 voices. */
  readonly voice: 'probe' | 'aircraft';
  readonly outDir: string;
  readonly bpm: number;
  readonly maxVoices: number;
  /** Where the committed CC0 kits are. */
  readonly samplesDir: string;
  /**
   * Put the events through the server's release queue before rendering (§1.4).
   *
   * On by default, because it is what a listener hears. `--spread 0` renders the
   * recording's own poll rhythm, which is the only way to A/B the change and the only
   * way to reproduce a render made before it existed.
   */
  readonly spread: boolean;
}

export interface RenderResult {
  readonly wavPath: string;
  readonly sha256: string;
  readonly eventsReplayed: number;
  readonly eventsDropped: number;
  readonly stolenVoices: number;
  /** Spread past the end of the render, so never sounded. See `render`. */
  readonly eventsBeyondEnd: number;
  /**
   * Distinct instants the events land on after the client's grid quantisation — the
   * piece's real density, and the measurement the onset detector was removed in
   * favour of.
   */
  readonly audibleInstants: number;
  readonly durationSeconds: number;
  readonly reproducible: boolean;
  /** Which voice produced the audio. `probe` means a measurement fixture, not music. */
  readonly voice: string;
}

interface RecordedEventLine {
  t: number;
  events: {
    id: string;
    type: string;
    t: number;
    rel: { bearing_deg: number; distance_km: number };
    geo: { alt_ft: number | null };
    attrs: { heavy: boolean; category: string | null; described_as: string };
    salience: number;
    caption: string;
    sim: boolean;
    scheduled: boolean;
  }[];
}

/**
 * Put the replay list through the server's release queue (§1.4).
 *
 * A recording's timestamps are poll timestamps: every event in one poll shares one,
 * so a flattened recording is 25 chords rather than 684 notes. The live server spreads
 * them (`server/src/spreader.ts`), so a render that did not would be measuring a piece
 * nobody will hear — and this is the change the next A/B is about.
 *
 * The real `Spreader` is driven here by a virtual clock at its own tick, which is why
 * it is generic over anything with a salience.
 */
export function spreadReplay(
  replay: readonly { offsetSeconds: number; event: unknown }[],
  score: ScoreConfig,
): { offsetSeconds: number; event: unknown }[] {
  const spread = score.spread;
  const spreader = new Spreader<{ readonly salience: number }>({ score });
  const out: { offsetSeconds: number; event: unknown }[] = [];
  const last = replay.length === 0 ? 0 : (replay[replay.length - 1]?.offsetSeconds ?? 0);
  const endMs = (last + spread.max_delay_s + spread.window_s + 1) * 1000;
  let index = 0;
  for (let ms = 0; ms <= endMs; ms += spread.tick_ms) {
    const batch: { readonly salience: number }[] = [];
    while (index < replay.length) {
      const item = replay[index];
      if (item === undefined || item.offsetSeconds * 1000 > ms) break;
      batch.push(item.event as { readonly salience: number });
      index += 1;
    }
    if (batch.length > 0) spreader.offer(batch, ms);
    for (const event of spreader.drain(ms)) out.push({ offsetSeconds: ms / 1000, event });
  }
  // Whatever the queue is still holding is released at the end of the virtual clock.
  // These land past the render's own length, where they are scheduled but never
  // sounded, so `render` counts them separately rather than reporting them as played
  // — the earlier version appended them here with a comment claiming they were "not
  // dropped", which was exactly backwards.
  let tail = endMs / 1000;
  for (const event of spreader.drain(endMs + spread.max_delay_s * 1000)) {
    out.push({ offsetSeconds: tail, event });
    tail += spread.tick_ms / 1000;
  }
  return out;
}

/** Flatten a recording into a replay list, with times relative to the slice start. */
export async function loadEvents(
  path: string,
  minutes: number,
): Promise<{ offsetSeconds: number; event: unknown }[]> {
  const lines = (await readRecording(path)) as RecordedEventLine[];
  const all = lines.flatMap((line) => line.events ?? []);
  if (all.length === 0) return [];
  const start = Math.min(...all.map((event) => event.t));
  const limit = minutes * 60 * 1000;
  return all
    .filter((event) => event.t - start <= limit)
    .map((event) => ({ offsetSeconds: (event.t - start) / 1000, event }))
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}

/**
 * Read the committed CC0 kits off disk, for the page to decode (§6.9).
 *
 * The render page has no origin and no network, so the samples travel as base64 in
 * the `renderOffline` argument. Roughly 4 MB of JSON once encoded, which the
 * Playwright bridge carries without complaint — and keeping the page offline is what
 * makes a render depend on nothing but the bundle and the recording.
 */
function readSamples(directory: string): {
  manifest: Record<string, number[]>;
  files: Record<string, string>;
} {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Record<
    string,
    number[]
  >;
  const files: Record<string, string> = {};
  for (const [kit, midis] of Object.entries(manifest)) {
    for (const midi of midis) {
      const name = `${kit}/${String(midi)}.m4a`;
      files[name] = readFileSync(join(directory, name)).toString('base64');
    }
  }
  return { manifest, files };
}

/** WAV header for already-interleaved 16-bit PCM. */
function wavHeader(dataBytes: number, channelCount: number, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
  buffer.writeUInt16LE(channelCount * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

export async function render(options: RenderOptions): Promise<RenderResult> {
  const recorded = await loadEvents(options.eventsPath, options.minutes);
  const durationSeconds = Math.max(10, options.minutes * 60);
  const score = loadScore();
  const spreadAll = options.spread ? spreadReplay(recorded, score) : recorded;
  // Spreading moves events later, so the last poll of the slice can fall past the end
  // of the render. `AudioEngine.schedule` accepts a time beyond the offline context's
  // length and the note simply never sounds, which counted it as played: a render
  // reporting 617 events replayed while rendering 505 of them.
  const replay = spreadAll.filter((item) => item.offsetSeconds < durationSeconds);
  const beyondEnd = spreadAll.length - replay.length;
  // How many distinct instants the piece actually has, which is not how many events
  // it has: the client quantises every gesture onto `quantize_beats` (§6.3), so
  // events inside one grid step are heard as one chord. This is the density number
  // the lab used to try to measure with an onset detector and could not — three were
  // scored against this very figure and the best managed F1 0.45 (docs/decisions.md).
  // Counted here instead, exactly, from the schedule.
  const gridSeconds = (60 / score.audio.transport.bpm) * score.audio.transport.quantize_beats;
  const audibleInstants = new Set(replay.map((item) => Math.ceil(item.offsetSeconds / gridSeconds)))
    .size;
  const seedNumber = seedFromString(options.seed);

  mkdirSync(options.outDir, { recursive: true });

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    // The bundle is built by Vite into a single IIFE so the page needs no network.
    await page.goto('about:blank');
    await page.addScriptTag({ path: join(options.outDir, '..', 'bundle', 'lab-bundle.js') });

    const meta = await page.evaluate(
      async (input: {
        replay: { offsetSeconds: number; event: unknown }[];
        durationSeconds: number;
        seedNumber: number;
        bpm: number;
        maxVoices: number;
        withReverb: boolean;
        voice: 'probe' | 'aircraft';
        audio: unknown;
        samples: unknown;
      }) => {
        const api = (globalThis as unknown as { BrickCityLab: Record<string, unknown> })
          .BrickCityLab;
        const fn = api['renderOffline'] as (argument: typeof input) => Promise<{
          samples: number;
          channelCount: number;
          sampleRate: number;
          dropped: number;
          stolen: number;
        }>;
        return fn(input);
      },
      {
        replay,
        durationSeconds,
        seedNumber,
        bpm: options.bpm,
        maxVoices: options.maxVoices,
        withReverb: options.preset === 'with-reverb',
        voice: options.voice,
        audio: options.voice === 'aircraft' ? score.audio : null,
        samples: options.voice === 'aircraft' ? readSamples(options.samplesDir) : null,
      },
    );

    if (errors.length > 0) {
      throw new Error(`render failed in the page:\n  ${errors.join('\n  ')}`);
    }

    // Collect the PCM in slices. 2 MB of samples at a time keeps both sides' memory
    // flat regardless of how long the render is — a 24-hour render (§13 Phase 2)
    // must work the same way a 10-minute one does.
    const CHUNK_SAMPLES = 1_000_000;
    const parts: Buffer[] = [wavHeader(meta.samples * 2, meta.channelCount, meta.sampleRate)];
    for (let offset = 0; offset < meta.samples; offset += CHUNK_SAMPLES) {
      const base64 = await page.evaluate(
        ([start, length]: [number, number]) => {
          const api = (globalThis as unknown as { BrickCityLab: Record<string, unknown> })
            .BrickCityLab;
          return (api['takeChunk'] as (a: number, b: number) => string)(start, length);
        },
        [offset, CHUNK_SAMPLES] as [number, number],
      );
      parts.push(Buffer.from(base64, 'base64'));
    }
    await page.evaluate(() => {
      const api = (globalThis as unknown as { BrickCityLab: Record<string, unknown> }).BrickCityLab;
      (api['releaseRender'] as () => void)();
    });

    const wav = Buffer.concat(parts);
    const name = `${new Date().toISOString().slice(0, 10)}-${options.voice}-${options.preset}-${options.seed}.wav`;
    const wavPath = join(options.outDir, name);
    writeFileSync(wavPath, wav);

    return {
      wavPath,
      sha256: createHash('sha256').update(wav).digest('hex'),
      eventsReplayed: replay.length - meta.dropped,
      eventsDropped: meta.dropped,
      stolenVoices: meta.stolen,
      eventsBeyondEnd: beyondEnd,
      audibleInstants,
      durationSeconds,
      reproducible: options.preset === 'deterministic',
      voice: options.voice,
    };
  } finally {
    await browser.close();
  }
}

function parseArgs(argv: string[]): RenderOptions {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(`--${flag}`);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const voice = get('voice', 'probe');
  if (voice !== 'probe' && voice !== 'aircraft') {
    throw new Error(`unknown voice ${voice}; use probe or aircraft`);
  }
  const preset = get('preset', 'deterministic');
  if (preset !== 'deterministic' && preset !== 'with-reverb') {
    throw new Error(`unknown preset ${preset}; use deterministic or with-reverb`);
  }
  return {
    eventsPath: get(
      'events',
      'data/recordings/' + new Date().toISOString().slice(0, 10) + '-event.ndjson.gz',
    ),
    minutes: Number(get('minutes', '10')),
    seed: get('seed', 'demo'),
    preset,
    voice,
    outDir: get('out', 'lab/renders'),
    samplesDir: get('samples', 'client/public/samples'),
    spread: get('spread', '1') !== '0',
    bpm: Number(get('bpm', '68')),
    // From the score, not a literal: the lab had its own 24 while §6.8's desktop cap
    // was tuned to 40, so a render dropped events the live page would have played and
    // measured a thinner piece than anyone hears.
    maxVoices: Number(get('max-voices', String(loadScore().audio.voices.max_desktop))),
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  const options = parseArgs(process.argv.slice(2));
  render(options)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
