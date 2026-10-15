/**
 * The release queue. SPEC §1.4, §6.5.
 *
 * Two properties matter and neither is audible as a bug: **no event is ever lost**,
 * and **no batch is ever released as a chord**. A queue that silently dropped a
 * quarter of the city would sound like a quieter city, and the clumping it exists to
 * fix went unnoticed for two listening rounds.
 */

import { describe, expect, it } from 'vitest';
import { Spreader } from './spreader.js';
import type { ScoreConfig } from './config.js';
import { loadScore } from './config.js';

interface Note {
  readonly salience: number;
  readonly id: number;
}

function withSpread(overrides: Partial<ScoreConfig['spread']> = {}): ScoreConfig {
  const score = loadScore();
  return { ...score, spread: { ...score.spread, ...overrides } };
}

function batch(count: number, salience = 0.5): Note[] {
  return Array.from({ length: count }, (_, index) => ({ salience, id: index }));
}

/** Run the clock for `seconds`, returning what came out and when. */
function run(
  spreader: Spreader<Note>,
  score: ScoreConfig,
  seconds: number,
  offer?: { at: number; events: Note[] }[],
): { ms: number; events: Note[] }[] {
  const out: { ms: number; events: Note[] }[] = [];
  const pending = [...(offer ?? [])];
  for (let ms = 0; ms <= seconds * 1000; ms += score.spread.tick_ms) {
    while (pending.length > 0 && (pending[0]?.at ?? Infinity) <= ms) {
      const item = pending.shift();
      if (item !== undefined) spreader.offer(item.events, ms);
    }
    const released = spreader.drain(ms);
    if (released.length > 0) out.push({ ms, events: released });
  }
  return out;
}

describe('Spreader', () => {
  it('turns one batch into a stream rather than a chord', () => {
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    const ticks = run(spreader, score, 20, [{ at: 0, events: batch(16) }]);

    const total = ticks.reduce((sum, tick) => sum + tick.events.length, 0);
    expect(total).toBe(16);
    // The measured failure: sixteen notes inside one tenth of a second.
    expect(Math.max(...ticks.map((tick) => tick.events.length))).toBeLessThanOrEqual(3);
    // And spread over something like the window, not crammed into the first second.
    const last = ticks[ticks.length - 1]?.ms ?? 0;
    expect(last).toBeGreaterThan(score.spread.window_s * 1000 * 0.5);
  });

  it('never loses an event, even when a batch is far bigger than the window', () => {
    // The real recording's first batch: 161 events at once, first sight of every
    // aircraft in range.
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    const ticks = run(spreader, score, 120, [{ at: 0, events: batch(161) }]);
    const total = ticks.reduce((sum, tick) => sum + tick.events.length, 0);
    expect(total).toBe(161);
    expect(spreader.waiting).toBe(0);
  });

  it('never exceeds the cap, however far behind it falls', () => {
    // The defect this replaces: the forced release for overdue events ignored the
    // cap, so one 500-event batch put 142 events inside a single 250 ms tick — nine
    // times the chord the file exists to prevent. The old version of this test
    // asserted `toBeGreaterThan(1)` on those ticks and passed with 180.
    const score = withSpread({ max_delay_s: 5, max_per_tick: 1 });
    const spreader = new Spreader<Note>({ score });
    const ticks = run(spreader, score, 200, [{ at: 0, events: batch(500) }]);
    expect(Math.max(...ticks.map((tick) => tick.events.length))).toBe(1);
    expect(ticks.reduce((sum, tick) => sum + tick.events.length, 0)).toBe(500);
  });

  it('caps a batch too big for the window too', () => {
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    const ticks = run(spreader, score, 300, [{ at: 0, events: batch(500) }]);
    expect(Math.max(...ticks.map((tick) => tick.events.length))).toBeLessThanOrEqual(
      score.spread.max_per_tick,
    );
    expect(ticks.reduce((sum, tick) => sum + tick.events.length, 0)).toBe(500);
  });

  it('releases an overdue event before a fresher one', () => {
    // The queue is ordered by when a slot falls due, and a later batch can hold
    // slots earlier than an overdue event's — so without this the oldest events are
    // walked past indefinitely under steady pressure.
    const score = withSpread({ max_delay_s: 2, max_per_tick: 1 });
    const spreader = new Spreader<Note>({ score });
    // Twenty quiet events, then a flood of loud ones a second later. Under the cap
    // the flood's slots interleave with the stragglers' and would walk past them.
    const first = Array.from({ length: 20 }, (_, index) => ({ salience: 0.1, id: index }));
    const flood = Array.from({ length: 200 }, (_, index) => ({ salience: 0.9, id: 100 + index }));
    const ticks = run(spreader, score, 90, [
      { at: 0, events: first },
      { at: 1000, events: flood },
    ]);
    const lastOld = Math.max(
      ...ticks.filter((tick) => tick.events.some((note) => note.id < 100)).map((tick) => tick.ms),
    );
    // The guarantee is its own slot — at most one window after it arrived — plus
    // whatever the cap costs, not "the deadline". Before the overdue path existed
    // and before `late` was sorted by arrival, the last straggler came out at 47 s.
    expect(lastOld).toBeLessThan((score.spread.window_s + 1) * 1000);
    // And once it has caught up, nothing is reported as behind.
    expect(spreader.waiting).toBe(0);
    expect(spreader.overdue).toBe(0);
  });

  it('releases a small batch rather than sitting on it for ever', () => {
    // Three events over a nine-second window is 0.08 of an event per tick, which
    // floors to zero — the bug this case exists for.
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    const ticks = run(spreader, score, 30, [{ at: 0, events: batch(3) }]);
    expect(ticks.reduce((sum, tick) => sum + tick.events.length, 0)).toBe(3);
  });

  it('leads each batch with its strongest event', () => {
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    const quiet = { salience: 0.1, id: 1 };
    const loud = { salience: 0.9, id: 2 };
    const ticks = run(spreader, score, 20, [{ at: 0, events: [quiet, loud] }]);
    expect(ticks[0]?.events[0]?.id).toBe(2);
  });

  it('is empty when nothing has arrived', () => {
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    expect(run(spreader, score, 10)).toEqual([]);
  });

  it('keeps up with the real rate', () => {
    // 684 events in six minutes, the measured slice, arriving as 25 batches.
    const score = withSpread();
    const spreader = new Spreader<Note>({ score });
    const offers = Array.from({ length: 25 }, (_, index) => ({
      at: index * 11_300,
      events: batch(index === 0 ? 161 : 16),
    }));
    const ticks = run(spreader, score, 420, offers);
    const total = ticks.reduce((sum, tick) => sum + tick.events.length, 0);
    expect(total).toBe(161 + 24 * 16);
    // What the piece should sound like: a note every half second or so, never
    // sixteen at once.
    expect(Math.max(...ticks.map((tick) => tick.events.length))).toBeLessThanOrEqual(3);
    // And the gaps are gone. The measured median gap between batches was 11.3 s;
    // nothing here should be anywhere near that.
    const gaps = ticks.slice(1).map((tick, index) => tick.ms - (ticks[index]?.ms ?? 0));
    expect(Math.max(...gaps)).toBeLessThan(4000);
  });
});
