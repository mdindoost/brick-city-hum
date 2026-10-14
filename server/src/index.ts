/**
 * Brick City Hum — server entry point.
 *
 * SPEC §5: collectors → normalizer → event bus → governor → WebSocket fan-out.
 * Phase 0 reaches "collectors → recorder". The bus, governor and WebSocket arrive in
 * Phase 1; what matters now is that this process can run unattended for the 48 hours
 * §13 requires.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { AircraftCollector } from './collectors/aircraft.js';
import { PathCollector } from './collectors/path.js';
import { loadPlaces, loadSources } from './config.js';
import { HealthRegistry } from './health.js';
import { Recorder } from './recorder.js';
import { SimulatorFallback } from './sim/fallback.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedFromString } from '../../shared/random.js';

/**
 * Load `.env` if it is there.
 *
 * Node does not read `.env` on its own, and the smoke test caught this: the server
 * ran with `contact: unconfigured` even though `.env` held the address, so every
 * request would have gone out unattributable (SPEC §9.1). Absent in production,
 * where Docker supplies the environment directly — hence the existence check rather
 * than a hard failure.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const PORT = Number(process.env['PORT'] ?? 8080);
const RECORDINGS_DIR = process.env['RECORDINGS_DIR'] ?? 'data/recordings';

function contactAddress(): string {
  const contact = process.env['CONTACT_EMAIL'];
  if (contact === undefined || contact.length === 0) {
    // SPEC §9.1 requires an honest User-Agent with a contact address. We start anyway
    // rather than block development, but say so loudly: until this is set, a
    // maintainer who notices our traffic has no way to reach us, and their only
    // remaining option is to block us.
    console.warn(
      '[config] CONTACT_EMAIL is not set. Outbound requests will identify as "unconfigured".\n' +
        '         Set it in .env — see .env.example and SPEC §9.1.',
    );
    return 'unconfigured';
  }
  return contact;
}

let cachedUserAgent: string | undefined;

/** Computed once: the missing-contact warning should be said once, not per call. */
export function userAgent(): string {
  cachedUserAgent ??= `brick-city-hum/0.1 (+https://github.com/mdindoost/brick-city-hum; contact: ${contactAddress()})`;
  return cachedUserAgent;
}

function main(): void {
  const places = loadPlaces();
  const sources = loadSources();
  const health = new HealthRegistry(sources.aircraft.backoff.failures_before_degraded);
  const recorder = new Recorder({ directory: RECORDINGS_DIR });

  // SPEC §3.5's labelled last resort. Built from recorded days, so it redistributes
  // real traffic rather than inventing any (§1.2), and everything it emits says
  // "(replay)".
  const fallback = new SimulatorFallback({
    sources,
    health,
    seed: seedFromString(new Date().toISOString().slice(0, 10)),
  });

  const aircraft = new AircraftCollector({
    sources,
    places,
    health,
    recorder,
    userAgent: userAgent(),
  });

  // Rail (§3.1 R3). A separate collector with its own loop and its own health entry:
  // §14's fallback strategy depends on a source being swappable in isolation, and a
  // PATH outage must not touch the aircraft.
  const path = new PathCollector({
    sources,
    places,
    health,
    userAgent: userAgent(),
    onEvents: (events, receivedAt) => {
      recorder.recordEvents(events, receivedAt);
      for (const event of events) console.log(`[path] ${event.caption}`);
    },
  });

  const server = createServer((request, response) => {
    if (request.url === '/healthz') {
      // SPEC §3.5 and §11.3: an external monitor watches this. It reports 503 when
      // no source is healthy, so a silent collector failure pages us instead of
      // looking like a quiet city.
      const now = Date.now();
      const recorderStats = recorder.stats();
      const body = {
        // Not just "a source is ok" but "a source succeeded recently" — see
        // HealthRegistry.anyHealthy. A recorder that has started failing its writes
        // also makes this false, because recording is the deliverable in Phase 0.
        // The simulator keeps the radio playing but does NOT make us healthy: a
        // monitor must still be able to tell a live city from a replay of one.
        ok: health.anyHealthy(now) && recorderStats.failures === 0,
        activeSource: aircraft.currentSourceId() ?? null,
        trackedAircraft: aircraft.tracks.size,
        eventsDetected: aircraft.eventCount(),
        recordingDay: recorder.today(),
        recorder: recorderStats,
        simulator: {
          active: fallback.isActive,
          hasModel: fallback.hasModel,
        },
        sources: health.all(),
      };
      response
        .writeHead(body.ok ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify(body, null, 2));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
  });

  server.listen(PORT, () => {
    console.log(`[boot] listening on :${String(PORT)} — health at /healthz`);
    console.log(
      `[boot] origin ${places.origin.name} ${String(places.origin.lat)},${String(places.origin.lon)}`,
    );
    console.log(`[boot] recording to ${RECORDINGS_DIR}`);
    console.log(`[boot] User-Agent: ${userAgent()}`);
    aircraft.start();
    path.start();

    // Load the traffic model in the background: it reads every recorded event file,
    // and the collector must not wait on it. Without a model there is simply no
    // fallback, which is the correct behaviour on a first run.
    void (async () => {
      try {
        const files = readdirSync(RECORDINGS_DIR)
          .filter((name) => name.includes('-event.'))
          .map((name) => join(RECORDINGS_DIR, name));
        if (files.length === 0) {
          console.log('[sim] no recorded events yet — no fallback available until there are');
          return;
        }
        const count = await fallback.loadModel(files);
        console.log(`[sim] traffic model built from ${String(count)} recorded events`);
      } catch (error) {
        console.error('[sim] could not build a traffic model', error);
      }
    })();

    // Checked on the simulator's own window. Returns nothing whenever a real source
    // is healthy — the real city always wins.
    setInterval(() => {
      const events = fallback.tick();
      if (events.length === 0) return;
      recorder.recordEvents(events, Date.now());
      for (const event of events) {
        console.log(`[sim] ${event.type} ${event.caption}`);
      }
    }, sources.simulator.window_s * 1000);
  });

  /**
   * Flush on shutdown. This is not housekeeping: `docker stop` sends SIGTERM, and
   * the recorder buffers, so exiting without closing its streams silently drops the
   * most recent records every single restart.
   */
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} — stopping collectors and flushing recordings`);
    aircraft.stop();
    path.stop();
    server.close();
    recorder
      .close()
      .then(() => {
        console.log('[shutdown] recordings flushed');
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error('[shutdown] failed to flush recordings', error);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // A poll must never take the process down: §13 needs 48 unbroken hours, and a
  // crash at hour 40 means starting over.
  process.on('unhandledRejection', (reason) => {
    console.error('[error] unhandled rejection', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[error] uncaught exception', error);
  });
}

main();
