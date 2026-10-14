/**
 * The demonstration server: the real page, fed by a real recording.
 *
 * Why this exists as its own entry point rather than a flag on the live server:
 *
 *  - It touches **no third-party API**. §9.1's manners are not a formality — we
 *    earned an HTTP 429 from adsb.lol on 2026-10-14 by restarting too often — and a
 *    page you open twenty times while tuning the layout must not cost a volunteer-run
 *    service twenty polls.
 *  - It leaves the live collector alone. That container is mid-recording and must not
 *    be restarted to look at the picture.
 *  - Everything it emits is honestly labelled: `Replayer` sets `sim: true` and adds
 *    "(replay)" to every caption (§1.2, §3.5). Nothing here is presented as live.
 *
 * Usage: npm run demo   →   http://127.0.0.1:8090
 */

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { loadPlaces, loadScore } from './config.js';
import { Hub } from './ws.js';
import { Replayer } from './sim/replay.js';

const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? '127.0.0.1';
const CLIENT_DIR = resolve('dist/client');
const RECORDINGS = resolve('data/recordings');
// Four times real time by default. The city produces about 1.4 events a minute, so a
// 1x replay is a nearly empty screen — true, but useless for looking at the drawing.
// The page states the speed, so nothing is misrepresented. REPLAY_SPEED=1 gives the
// city's real rhythm.
const SPEED = Number(process.env.REPLAY_SPEED ?? 4);
const TICK_MS = 250;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * The event recording to replay.
 *
 * `EVENTS` names a file directly. Otherwise the newest in `data/redetect/` wins over
 * `data/recordings/`, because a stored recording holds the events the detector made
 * *at the time* and `lab/redetect.ts` re-derives them from the same observations under
 * today's rules — which is what you want to look at after changing a rule.
 */
function latestRecording(): string {
  const named = process.env.EVENTS;
  if (named !== undefined && named !== '') return named;
  const redetect = resolve('data/redetect');
  if (existsSync(redetect)) {
    const fresh = readdirSync(redetect)
      .filter((name) => name.endsWith('-event.ndjson.gz'))
      .sort();
    const newest = fresh[fresh.length - 1];
    if (newest !== undefined) return join(redetect, newest);
  }
  if (!existsSync(RECORDINGS)) throw new Error(`no recordings directory at ${RECORDINGS}`);
  const files = readdirSync(RECORDINGS)
    .filter((name) => name.endsWith('-event.ndjson.gz'))
    .sort();
  const newest = files[files.length - 1];
  if (newest === undefined) throw new Error(`no *-event.ndjson.gz in ${RECORDINGS}`);
  return join(RECORDINGS, newest);
}

async function main(): Promise<void> {
  const places = loadPlaces();
  const score = loadScore();

  const path = latestRecording();
  const replayer = new Replayer({ path, speed: SPEED, loop: true });
  const count = await replayer.load();
  if (count === 0) throw new Error(`${path} contains no valid events`);

  const server = createServer((request, response) => {
    // Static file serving, resolved inside dist/client and nowhere else. The
    // normalize+startsWith pair is what stops `GET /../../.env` from working.
    const url = (request.url ?? '/').split('?')[0] ?? '/';
    const requested = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '');
    const file = normalize(join(CLIENT_DIR, requested));
    if (!file.startsWith(CLIENT_DIR) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(
        'Not built yet. Run: npm run demo\n(which builds the client into dist/client first)\n',
      );
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });

  const hub = new Hub({
    server,
    origin: { lat: places.origin.lat, lon: places.origin.lon, name: places.origin.name },
    visual: score.visual,
    audio: score.audio,
    playLeadMs: score.play_lead_ms,
    replay: true,
    replaySpeed: SPEED,
  });

  const startedAt = Date.now();
  let since = -1;
  setInterval(() => {
    const now = Date.now() - startedAt;
    const due = replayer.due(since, now);
    since = now;
    hub.broadcast(due);
  }, TICK_MS).unref?.();

  server.listen(PORT, HOST, () => {
    const span = Math.round(replayer.spanMs / 60000);
    console.log(
      `[demo] replaying ${String(count)} recorded events (${String(span)} min) at ${String(SPEED)}x`,
    );
    console.log(`[demo] ${path}`);
    console.log(`[demo] open http://${HOST}:${String(PORT)}`);
  });
}

void main().catch((error: unknown) => {
  console.error('[demo] failed to start:', error);
  process.exitCode = 1;
});
