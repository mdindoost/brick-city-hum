/**
 * Replay a recorded day's **observations** through the current detector and write a
 * fresh event recording. SPEC §7.3 step 2, and §3.5's replay in its other direction.
 *
 * Why this exists: a recording stores what the collector saw *and* what the detector
 * made of it at the time. When a rule changes — and §3.2 says plainly that its
 * thresholds are starting values — the stored events are the old rules' answer, so
 * rendering from them measures yesterday's music. This runs the real detector over the
 * real sky again and writes the events it produces now.
 *
 * It is also the honest way to answer "how much busier would the piece be?" without
 * touching a third-party API: the 14/10 observations gave 1.4 events a minute under
 * the original rules and 8.6 under the distance rings, from the same aircraft.
 *
 * Usage:
 *   npx tsx lab/redetect.ts --observations data/recordings/2026-10-14-observation.ndjson.gz
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { basename, join } from 'node:path';
import { ulid } from 'ulid';
import { readRecording } from '../server/src/recorder.js';
import { Detector } from '../server/src/detector.js';
import { loadPlaces, loadScore, loadSources } from '../server/src/config.js';
import { DensityGovernor } from '../server/src/governor.js';
import type { Observation } from '../server/src/observation.js';
import type { CityEvent } from '../server/src/events.js';

interface ObservationLine {
  t: number;
  observations: Observation[];
}

export async function redetect(observationsPath: string, outDir: string): Promise<string> {
  const detector = new Detector({
    places: loadPlaces(),
    sources: loadSources(),
    makeId: () => ulid(),
  });

  // The governor runs here too, so a re-derived recording holds the piece as it would
  // have been heard rather than every event the detector could find (§6.5).
  const governor = new DensityGovernor({ score: loadScore() });
  const lines = (await readRecording(observationsPath)) as ObservationLine[];
  // Two observations are all the detector needs, so the history is capped rather than
  // accumulated: a day of traffic is otherwise several hundred megabytes of track.
  const history = new Map<string, Observation[]>();
  const out: { t: number; events: CityEvent[] }[] = [];

  for (const line of lines) {
    const events: CityEvent[] = [];
    for (const observation of line.observations) {
      const track = history.get(observation.icao) ?? [];
      // The live path only sees an aircraft when its position is new; counting a
      // repeated fix as another step of the track invents gate crossings.
      if (track.length > 0 && track[track.length - 1]?.t === observation.t) continue;
      track.push(observation);
      if (track.length > 2) track.shift();
      history.set(observation.icao, track);
      events.push(...detector.detect(track));
    }
    if (events.length > 0) out.push({ t: line.t, events: governor.admit(events, line.t) });
  }

  mkdirSync(outDir, { recursive: true });
  const name = basename(observationsPath).replace('-observation', '-event');
  const path = join(outDir, name);
  await new Promise<void>((resolve, reject) => {
    const gzip = createGzip();
    const file = createWriteStream(path);
    gzip.pipe(file);
    file.on('finish', resolve);
    file.on('error', reject);
    for (const line of out) gzip.write(`${JSON.stringify(line)}\n`);
    gzip.end();
  });

  const total = out.reduce((sum, line) => sum + line.events.length, 0);
  const spanMinutes =
    out.length > 1 ? ((out[out.length - 1]?.t ?? 0) - (out[0]?.t ?? 0)) / 60000 : 0;
  const voices = out.reduce(
    (sum, line) => sum + line.events.filter((e) => e.tier === 'voice').length,
    0,
  );
  console.log(
    `${String(total)} events over ${spanMinutes.toFixed(0)} min = ` +
      `${(total / Math.max(1, spanMinutes)).toFixed(2)} per minute ` +
      `(${(voices / Math.max(1, spanMinutes)).toFixed(2)} foreground, the rest texture)`,
  );
  console.log(path);
  return path;
}

const argv = process.argv.slice(2);
const index = argv.indexOf('--observations');
const observations =
  index >= 0
    ? (argv[index + 1] ?? '')
    : `data/recordings/${new Date().toISOString().slice(0, 10)}-observation.ndjson.gz`;
const outIndex = argv.indexOf('--out');
const outDir = outIndex >= 0 ? (argv[outIndex + 1] ?? 'data/redetect') : 'data/redetect';
void redetect(observations, outDir).catch((error: unknown) => {
  console.error('[redetect] failed:', error);
  process.exitCode = 1;
});
