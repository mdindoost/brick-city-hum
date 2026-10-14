/**
 * The lab's in-page entry point.
 *
 * Bundled by Vite into a single IIFE so the render page needs no network and no
 * module resolution — Playwright injects one script tag and calls one function.
 *
 * **The Math.random override happens here, before Tone is imported.** That ordering
 * is load-bearing: `Tone.Reverb` generates its impulse response from noise at
 * construction time, so an override installed later would already be too late.
 */

import { mulberry32 } from '../shared/random.js';

export interface RenderInput {
  replay: { offsetSeconds: number; event: unknown }[];
  durationSeconds: number;
  seedNumber: number;
  bpm: number;
  maxVoices: number;
  withReverb: boolean;
}

/**
 * Where the rendered PCM waits to be collected, in chunks.
 *
 * Returning the samples from `renderOffline` directly crashed the page: ten minutes
 * of stereo at 44.1 kHz is 26 million floats per channel, and boxing those into a JS
 * array and JSON-serialising them across the Playwright bridge exhausts memory. So
 * the page converts to interleaved 16-bit PCM — the format the WAV wants anyway —
 * and Node collects it in slices.
 */
let pending: Int16Array | undefined;

export function takeChunk(offset: number, length: number): string {
  if (pending === undefined) return '';
  const slice = pending.subarray(offset, Math.min(offset + length, pending.length));
  const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function releaseRender(): void {
  pending = undefined;
}

export async function renderOffline(input: RenderInput): Promise<{
  samples: number;
  channelCount: number;
  sampleRate: number;
  dropped: number;
  stolen: number;
}> {
  // Replace the global PRNG for the whole render. Any library reaching for
  // Math.random — Tone's reverb above all — now draws from the seeded stream, which
  // is what makes two renders of the same slice bit-identical (§5, §7.3).
  const seeded = mulberry32(input.seedNumber);
  /* Assigning to Math.random is the point of this line, not a violation of the rule
     that bans reading it: this is what forces every library — Tone's reverb impulse
     response above all — to draw from the seeded stream, which is what makes two
     renders of the same slice bit-identical (§5, §7.3). */
  // eslint-disable-next-line no-restricted-properties
  Math.random = seeded;

  const Tone = await import('tone');
  const { AudioEngine } = await import('../client/src/audio/engine.js');
  const { ProbeVoice, ProbeDrone } = await import('./fixtures/probe-voice.js');

  let dropped = 0;
  let stolen = 0;

  const buffer = await Tone.Offline(
    async ({ transport }) => {
      transport.bpm.value = input.bpm;
      const engine = new AudioEngine({
        maxVoices: input.maxVoices,
        targetLufs: -20,
        sectionSeed: input.seedNumber,
        // A minor pentatonic on D — a placeholder scale for the fixture, not a
        // palette decision. Palettes are §6.2 and Phase 2.
        scale: [0, 3, 5, 7, 10],
        rootMidi: 62,
        bpm: input.bpm,
      });
      engine.register(new ProbeVoice());
      await engine.prepare({ withReverb: input.withReverb });

      const drone = new ProbeDrone();
      drone.start(62, Tone.getDestination(), 0);

      for (const item of input.replay) {
        const accepted = engine.schedule(
          item.event as Parameters<typeof engine.schedule>[0],
          item.offsetSeconds,
        );
        if (!accepted) dropped += 1;
      }
      stolen = engine.stolenCount;
    },
    input.durationSeconds,
    2,
  );

  // Interleave and convert to 16-bit in one pass, so the float data can be released
  // immediately rather than existing alongside a second full-size copy.
  const channelCount = buffer.numberOfChannels;
  const frames = buffer.length;
  const interleaved = new Int16Array(frames * channelCount);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      const clamped = Math.max(-1, Math.min(1, data[frame] ?? 0));
      interleaved[frame * channelCount + channel] = Math.round(clamped * 32767);
    }
  }
  pending = interleaved;

  return {
    samples: interleaved.length,
    channelCount,
    sampleRate: buffer.sampleRate,
    dropped,
    stolen,
  };
}
