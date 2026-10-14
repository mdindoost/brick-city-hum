import { describe, expect, it } from 'vitest';
import { HealthRegistry } from './health.js';

const NOW = 1_700_000_000_000;

describe('HealthRegistry', () => {
  it('starts a registered source as idle, not down', () => {
    // A standby fallback that has never been polled is not failing. Reporting it as
    // down would page a human about a healthy system.
    const health = new HealthRegistry(3);
    health.register('adsb.fi');
    expect(health.get('adsb.fi')?.state).toBe('idle');
    expect(health.get('adsb.fi')?.consecutiveFailures).toBe(0);
  });

  it('degrades on the first failures and goes down at the threshold', () => {
    const health = new HealthRegistry(3);
    health.register('s');
    health.recordFailure('s', NOW, 'HTTP 503');
    expect(health.get('s')?.state).toBe('degraded');
    health.recordFailure('s', NOW, 'HTTP 503');
    expect(health.get('s')?.state).toBe('degraded');
    health.recordFailure('s', NOW, 'HTTP 503');
    expect(health.get('s')?.state).toBe('down');
  });

  it('resets the failure count on recovery', () => {
    const health = new HealthRegistry(3);
    health.register('s');
    health.recordFailure('s', NOW, 'boom');
    health.recordSuccess('s', NOW + 1000, 100, 0);
    expect(health.get('s')?.state).toBe('ok');
    expect(health.get('s')?.consecutiveFailures).toBe(0);
    expect(health.get('s')?.lastError).toBeNull();
  });

  it('remembers the last failure even after recovering', () => {
    const health = new HealthRegistry(3);
    health.register('s');
    health.recordFailure('s', NOW, 'boom');
    health.recordSuccess('s', NOW + 1000, 1, 0);
    expect(health.get('s')?.lastFailureAt).toBe(NOW);
  });

  describe('anyHealthy ages out', () => {
    it('is true right after a success', () => {
      const health = new HealthRegistry(3);
      health.register('s');
      health.recordSuccess('s', NOW, 100, 0);
      expect(health.anyHealthy(NOW + 1000)).toBe(true);
    });

    it('is false once the last success is stale', () => {
      // Without this bound, a poll loop that stopped rescheduling would leave
      // /healthz answering 200 with an hours-old lastSuccessAt, and a monitor could
      // not tell a stalled recorder from a quiet city — the one thing §3.5 says
      // health exists to prevent.
      const health = new HealthRegistry(3);
      health.register('s');
      health.recordSuccess('s', NOW, 100, 0);
      expect(health.anyHealthy(NOW + 130_000)).toBe(false);
    });

    it('is false when a source is registered but never polled', () => {
      const health = new HealthRegistry(3);
      health.register('s');
      expect(health.anyHealthy(NOW)).toBe(false);
    });

    it('is true when any one source is fresh, even if another is down', () => {
      const health = new HealthRegistry(3);
      health.register('primary');
      health.register('fallback');
      health.recordFailure('primary', NOW, 'down');
      health.recordSuccess('fallback', NOW, 50, 0);
      expect(health.anyHealthy(NOW + 1000)).toBe(true);
    });
  });
});
