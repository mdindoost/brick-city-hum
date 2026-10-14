/**
 * Clock sync. SPEC §9.4.
 *
 * Everyone must render and play the same event at the same instant, and no browser's
 * wall clock can be trusted — a laptop minutes out of step is ordinary. So the client
 * measures the **offset** between its own clock and the server's and works in server
 * time from then on.
 *
 * The estimator keeps the sample with the **lowest round trip**, not the average. A
 * slow reply spent unknown time in one direction or the other, which is exactly the
 * error we cannot correct for; a fast reply constrains the offset tightly. This is
 * the same reason NTP prefers its best sample over its mean.
 */

export interface ClockSample {
  readonly offsetMs: number;
  readonly roundTripMs: number;
}

export class ClockSync {
  private best: ClockSample | null = null;

  /** Fold in one completed probe. */
  accept(clientT0: number, serverMs: number, clientT1: number): void {
    const roundTripMs = clientT1 - clientT0;
    // Assume the two legs are equal: the server's clock at clientT1 is serverMs plus
    // half the round trip. Anything better needs a second clock we do not have.
    const offsetMs = serverMs + roundTripMs / 2 - clientT1;
    if (this.best === null || roundTripMs < this.best.roundTripMs) {
      this.best = { offsetMs, roundTripMs };
    }
  }

  /** Seed from the hello message, so the first events are not mis-scheduled. */
  seed(serverMs: number, clientNow: number): void {
    if (this.best === null) this.best = { offsetMs: serverMs - clientNow, roundTripMs: Infinity };
  }

  get synced(): boolean {
    return this.best !== null;
  }

  get roundTripMs(): number | null {
    return this.best === null || this.best.roundTripMs === Infinity ? null : this.best.roundTripMs;
  }

  /** The server's clock, right now, as well as we can tell. */
  serverNow(): number {
    return Date.now() + (this.best?.offsetMs ?? 0);
  }
}
