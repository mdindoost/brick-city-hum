import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AircraftCollector } from './aircraft.js';
import { HealthRegistry } from '../health.js';
import { Recorder } from '../recorder.js';
import { RetryableHttpError } from '../poller.js';
import { realPlaces, sourcesWithFakeFeeds } from '../testing.js';

const places = realPlaces();
const sources = sourcesWithFakeFeeds();

const AIRCRAFT = { ac: [{ hex: 'abc123', lat: 40.7, lon: -74.1, alt_baro: 3000 }] };

function setup(fetchByHost: Record<string, () => Promise<unknown>>) {
  const health = new HealthRegistry(3);
  const recorder = new Recorder({ directory: mkdtempSync(join(tmpdir(), 'bch-ac-')) });
  const urls: string[] = [];
  const collector = new AircraftCollector({
    sources,
    places,
    health,
    recorder,
    userAgent: 'test',
    deps: {
      now: () => Date.now(),
      random: () => 0,
      fetchJson: (url: string) => {
        urls.push(url);
        const host = url.includes('primary') ? 'primary' : 'fallback';
        const impl = fetchByHost[host];
        if (impl === undefined) return Promise.reject(new Error('no impl'));
        return impl();
      },
    },
  });
  return { collector, health, recorder, urls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AircraftCollector', () => {
  it('builds the URL from config and places, not from hard-coded values', async () => {
    const { collector, urls } = setup({ primary: () => Promise.resolve(AIRCRAFT) });
    collector.start();
    await vi.advanceTimersByTimeAsync(50);
    collector.stop();
    expect(urls[0]).toBe('https://primary.invalid/40.74194/-74.17889/25');
  });

  it('polls the primary while it is healthy and never touches the fallback', async () => {
    const { collector, urls } = setup({ primary: () => Promise.resolve(AIRCRAFT) });
    collector.start();
    await vi.advanceTimersByTimeAsync(60_000);
    collector.stop();
    expect(urls.every((url) => url.includes('primary'))).toBe(true);
    // Polling both continuously would double the load on two volunteer services to
    // gain nothing, since they carry the same traffic.
    expect(urls.some((url) => url.includes('fallback'))).toBe(false);
  });

  it('fails over to the fallback once the primary is down', async () => {
    const { collector, health, urls } = setup({
      primary: () => Promise.reject(new RetryableHttpError(503, 'u')),
      fallback: () => Promise.resolve(AIRCRAFT),
    });
    collector.start();
    await vi.advanceTimersByTimeAsync(90_000);
    collector.stop();
    expect(health.get('primary')?.state).toBe('down');
    expect(urls.some((url) => url.includes('fallback'))).toBe(true);
    expect(collector.currentSourceId()).toBe('fallback');
  });

  it('comes back to the primary when it recovers', async () => {
    // The regression this pins: a stopped poller never polls, so the primary's
    // health was frozen at `down` and the "drift back" branch was unreachable. One
    // 30-second blip at hour 3 would have pinned the remaining 45 hours of a Phase 0
    // recording to the fallback, silently changing the poll cadence mid-dataset.
    let primaryWorks = false;
    const { collector, health, urls } = setup({
      primary: () =>
        primaryWorks ? Promise.resolve(AIRCRAFT) : Promise.reject(new RetryableHttpError(503, 'u')),
      fallback: () => Promise.resolve(AIRCRAFT),
    });
    collector.start();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(collector.currentSourceId()).toBe('fallback');

    primaryWorks = true;
    await vi.advanceTimersByTimeAsync(180_000);
    collector.stop();

    expect(health.get('primary')?.state).toBe('ok');
    expect(collector.currentSourceId()).toBe('primary');
    expect(urls.filter((url) => url.includes('primary')).length).toBeGreaterThan(1);
  });

  it('keeps both sources polite when everything is failing', async () => {
    // Both down means the supervisor flips between them. Each service must still see
    // backoff, not a request every flip — which is the wrong behaviour precisely
    // when the cause is a 429.
    const { collector, urls } = setup({
      primary: () => Promise.reject(new RetryableHttpError(429, 'u')),
      fallback: () => Promise.reject(new RetryableHttpError(429, 'u')),
    });
    collector.start();
    await vi.advanceTimersByTimeAsync(300_000); // five minutes
    collector.stop();
    const perSource = urls.filter((u) => u.includes('primary')).length;
    // Over five minutes with a 5 s→5 min backoff curve, a well-behaved client makes
    // only a handful of attempts per source.
    expect(perSource).toBeLessThan(12);
    expect(urls.filter((u) => u.includes('fallback')).length).toBeLessThan(12);
  });

  it('tracks aircraft and records every poll, including empty ones', async () => {
    const { collector, recorder } = setup({ primary: () => Promise.resolve(AIRCRAFT) });
    collector.start();
    await vi.advanceTimersByTimeAsync(50);
    collector.stop();
    expect(collector.tracks.size).toBe(1);
    // An empty sky and a stopped collector must be distinguishable in the
    // recordings (§3.5, and P0-8's validation).
    expect(recorder.stats().written).toBeGreaterThan(0);
    await recorder.close();
  });

  it('treats a response it cannot parse as a failure, not as an empty sky', async () => {
    const { collector, health } = setup({
      primary: () => Promise.resolve({ ac: [{ hex: 'a', lat: 40.7, lon: -74.1, gs: 'fast' }] }),
      fallback: () => Promise.resolve(AIRCRAFT),
    });
    collector.start();
    await vi.advanceTimersByTimeAsync(50);
    collector.stop();
    expect(health.get('primary')?.state).not.toBe('ok');
    expect(health.get('primary')?.lastError).toMatch(/schema has probably changed/);
  });
});

describe('detector state is kept in step with the track store', () => {
  it('drops detector state when an aircraft leaves, not only track state', () => {
    // A mutation deleting the retainOnly call from the collector survived the entire
    // suite, because the only test for it exercised the method in isolation and never
    // the wiring. Over 48 hours that is an unbounded leak of per-aircraft state.
    const { collector } = setup({ primary: () => Promise.resolve(AIRCRAFT) });
    const anyCollector = collector as unknown as {
      handlePoll: (body: unknown, receivedAt: number, sourceId: string) => unknown;
    };
    const base = Date.now();
    anyCollector.handlePoll(
      { ac: [{ hex: 'aaa111', lat: 40.7, lon: -74.1, alt_baro: 3000 }] },
      base,
      'primary',
    );
    expect(collector.detector.trackedAircraft).toBe(1);

    // Much later, with a different aircraft: the first has expired from the track
    // store, so its detector state must go too.
    anyCollector.handlePoll(
      { ac: [{ hex: 'bbb222', lat: 40.7, lon: -74.1, alt_baro: 3000 }] },
      base + 10 * 60 * 1000,
      'primary',
    );
    expect(collector.tracks.size).toBe(1);
    expect(collector.detector.trackedAircraft).toBe(1);
  });
});
