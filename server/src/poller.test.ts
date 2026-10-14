import { describe, expect, it, vi } from 'vitest';
import { HealthRegistry } from './health.js';
import {
  backoffDelayMs,
  isRetryableStatus,
  PermanentHttpError,
  Poller,
  RetryableHttpError,
} from './poller.js';

const BACKOFF = { initialMs: 5000, multiplier: 2, maxMs: 300_000 };

describe('backoffDelayMs', () => {
  it('is zero before any failure', () => {
    expect(backoffDelayMs(BACKOFF, 0)).toBe(0);
  });

  it('doubles with each consecutive failure', () => {
    expect(backoffDelayMs(BACKOFF, 1)).toBe(5_000);
    expect(backoffDelayMs(BACKOFF, 2)).toBe(10_000);
    expect(backoffDelayMs(BACKOFF, 3)).toBe(20_000);
    expect(backoffDelayMs(BACKOFF, 4)).toBe(40_000);
  });

  it('is capped, so a long outage does not become an hour-long wait', () => {
    expect(backoffDelayMs(BACKOFF, 20)).toBe(300_000);
    expect(backoffDelayMs(BACKOFF, 1000)).toBe(300_000);
  });

  it('never returns a non-finite delay', () => {
    // 2**1000 overflows to Infinity; a setTimeout of Infinity would stop polling
    // forever and look exactly like a healthy quiet night.
    for (const failures of [1, 10, 100, 1000, 5000]) {
      expect(Number.isFinite(backoffDelayMs(BACKOFF, failures))).toBe(true);
    }
  });
});

describe('isRetryableStatus', () => {
  it('retries rate limiting and server errors', () => {
    for (const status of [429, 408, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), String(status)).toBe(true);
    }
  });

  it('does not retry a client error that waiting cannot fix', () => {
    // A 404 means the endpoint moved and retrying forever would hide that, which is
    // exactly what happened to airplanes.live (403, gated). That must fail over.
    for (const status of [400, 401, 403, 404, 410]) {
      expect(isRetryableStatus(status), String(status)).toBe(false);
    }
  });
});

describe('Poller', () => {
  function setup(fetchImpl: () => Promise<unknown>) {
    const health = new HealthRegistry(3);
    health.register('test-source');
    const handled: unknown[] = [];
    const poller = new Poller(
      {
        id: 'test-source',
        intervalMs: 10_000,
        jitterMs: 1500,
        timeoutMs: 8000,
        backoff: BACKOFF,
        userAgent: 'test',
      },
      () => 'https://example.invalid/data',
      (body) => {
        handled.push(body);
        return { count: 1, skipped: 0 };
      },
      health,
      { fetchJson: fetchImpl, now: () => 1_000_000, random: () => 0.5 },
    );
    return { poller, health, handled };
  }

  it('records a success with the observation count', async () => {
    const { poller, health, handled } = setup(() => Promise.resolve({ ac: [] }));
    await poller.pollOnce();
    expect(handled).toHaveLength(1);
    expect(health.get('test-source')?.state).toBe('ok');
    expect(health.get('test-source')?.lastCount).toBe(1);
  });

  it('degrades on a single failure but does not yet give up', async () => {
    const { poller, health } = setup(() =>
      Promise.reject(new RetryableHttpError(429, 'https://example.invalid')),
    );
    await poller.pollOnce();
    const status = health.get('test-source');
    expect(status?.state).toBe('degraded');
    expect(status?.consecutiveFailures).toBe(1);
    expect(status?.lastError).toContain('429');
  });

  it('is down after the configured number of consecutive failures', async () => {
    const { poller, health } = setup(() =>
      Promise.reject(new RetryableHttpError(503, 'https://example.invalid')),
    );
    await poller.pollOnce();
    await poller.pollOnce();
    expect(health.get('test-source')?.state).toBe('degraded');
    await poller.pollOnce();
    expect(health.get('test-source')?.state).toBe('down');
  });

  it('recovers cleanly, resetting the failure count', async () => {
    const health = new HealthRegistry(3);
    health.register('s');
    let shouldFail = true;
    const poller = new Poller(
      {
        id: 's',
        intervalMs: 10_000,
        jitterMs: 0,
        timeoutMs: 8000,
        backoff: BACKOFF,
        userAgent: 'test',
      },
      () => 'https://example.invalid',
      () => ({ count: 2, skipped: 0 }),
      health,
      {
        fetchJson: () =>
          shouldFail
            ? Promise.reject(new RetryableHttpError(503, 'u'))
            : Promise.resolve({ ac: [] }),
        now: () => 1,
        random: () => 0,
      },
    );
    await poller.pollOnce();
    expect(health.get('s')?.consecutiveFailures).toBe(1);
    shouldFail = false;
    await poller.pollOnce();
    expect(health.get('s')?.state).toBe('ok');
    expect(health.get('s')?.consecutiveFailures).toBe(0);
  });

  it('never throws out of a poll, whatever the failure', async () => {
    // An unhandled rejection would kill the process, and SPEC §13 needs 48 unbroken
    // hours of recording. A failed poll must cost one poll.
    for (const failure of [
      () => Promise.reject(new PermanentHttpError(404, 'u')),
      () => Promise.reject(new Error('socket hang up')),
      () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
      /* Deliberately not an Error: a library can reject with anything, and the
         poller must survive it rather than crash the 48-hour recording. */
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      () => Promise.reject('a string, not an Error'),
    ]) {
      const { poller } = setup(failure);
      await expect(poller.pollOnce()).resolves.toBeUndefined();
    }
  });

  it('does not overlap requests: the next poll is scheduled only after one settles', async () => {
    // setInterval would let a slow response overlap the next request and quietly
    // double our rate against a service that gives us no rate-limit headers to
    // notice it with.
    vi.useFakeTimers();
    let inFlight = 0;
    let maxConcurrent = 0;
    const health = new HealthRegistry(3);
    health.register('s');
    const poller = new Poller(
      { id: 's', intervalMs: 100, jitterMs: 0, timeoutMs: 1000, backoff: BACKOFF, userAgent: 't' },
      () => 'https://example.invalid',
      () => ({ count: 0, skipped: 0 }),
      health,
      {
        fetchJson: async () => {
          inFlight += 1;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 500));
          inFlight -= 1;
          return { ac: [] };
        },
        now: () => 1,
        random: () => 0,
      },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    poller.stop();
    vi.useRealTimers();
    expect(maxConcurrent).toBe(1);
  });

  it('stops scheduling once stopped', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const health = new HealthRegistry(3);
    health.register('s');
    const poller = new Poller(
      { id: 's', intervalMs: 100, jitterMs: 0, timeoutMs: 1000, backoff: BACKOFF, userAgent: 't' },
      () => 'https://example.invalid',
      () => ({ count: 0, skipped: 0 }),
      health,
      {
        fetchJson: () => {
          calls += 1;
          return Promise.resolve({ ac: [] });
        },
        now: () => 1,
        random: () => 0,
      },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(350);
    const afterStop = calls;
    poller.stop();
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    expect(calls).toBe(afterStop);
  });
});

describe('restart behaviour (the failover path)', () => {
  function failing() {
    const health = new HealthRegistry(3);
    health.register('s');
    const attempts: number[] = [];
    let clock = 0;
    const poller = new Poller(
      {
        id: 's',
        intervalMs: 10_000,
        jitterMs: 0,
        timeoutMs: 1000,
        backoff: BACKOFF,
        userAgent: 't',
      },
      () => 'https://example.invalid',
      () => ({ count: 0, skipped: 0 }),
      health,
      {
        fetchJson: () => {
          attempts.push(clock);
          return Promise.reject(new RetryableHttpError(503, 'u'));
        },
        now: () => clock,
        random: () => 0,
      },
    );
    return { poller, attempts, setClock: (t: number) => (clock = t) };
  }

  it('does not fire immediately on restart when failures are already behind it', async () => {
    // Every failover flap used to inject an un-backed-off request, which is exactly
    // wrong when the reason we failed over was a 429. Restart must honour the
    // backoff already earned.
    vi.useFakeTimers();
    const { poller, attempts } = failing();
    poller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(1); // the first attempt, with no history, is immediate

    poller.stop();
    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toHaveLength(1); // still waiting out the 5 s backoff

    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempts).toHaveLength(2);
    vi.useRealTimers();
  });

  it('runs one loop, not two, when stopped and restarted mid-request', async () => {
    // The in-flight continuation used to reschedule even after stop(), so a
    // stop/start inside the request window left two loops running and doubled our
    // request rate against a volunteer service.
    vi.useFakeTimers();
    let inFlight = 0;
    let maxConcurrent = 0;
    const health = new HealthRegistry(3);
    health.register('s');
    const poller = new Poller(
      {
        id: 's',
        intervalMs: 100,
        jitterMs: 0,
        timeoutMs: 60_000,
        backoff: BACKOFF,
        userAgent: 't',
      },
      () => 'https://example.invalid',
      () => ({ count: 0, skipped: 0 }),
      health,
      {
        fetchJson: async () => {
          inFlight += 1;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 500));
          inFlight -= 1;
          return { ac: [] };
        },
        now: () => 1,
        random: () => 0,
      },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(200); // a request is now in flight
    poller.stop();
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    poller.stop();
    vi.useRealTimers();
    expect(maxConcurrent).toBe(1);
  });
});
