/**
 * Detector validation harness. SPEC §13's Phase 0 gate: "spot-check 20 events
 * manually against a public flight tracker".
 *
 * This produces the table; **the judgement is Mohammad's** (§13 marks "detector
 * precision looks right" as [HUMAN]). It deliberately does not call any flight-
 * tracking API: those terms are a separate question we have not asked, and the point
 * of the exercise is a human looking at a tracker, not a machine agreeing with itself.
 *
 * It samples across dayparts rather than taking the first 20, because a run of
 * consecutive events is one traffic situation seen twenty times, which would tell us
 * much less than twenty situations seen once.
 *
 * Usage:
 *   npx tsx lab/validate.ts --count 20 --out docs/validation-2026-10-14.md
 */

import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRecording } from '../server/src/recorder.js';
import { eventSchema, type CityEvent } from '../server/src/events.js';
import { mulberry32 } from '../shared/random.js';

interface Sampled {
  readonly event: CityEvent;
  readonly local: string;
}

function localTime(epochMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(epochMs));
}

/**
 * Spread a sample across the recording rather than clustering it.
 *
 * Stratified by event type first, so a rare type (a helicopter) is checked even
 * though it is a small share of traffic — precision on the rare types is exactly
 * where a detector tends to be wrong.
 */
export function sample(events: readonly CityEvent[], count: number, seed: number): Sampled[] {
  const byType = new Map<string, CityEvent[]>();
  for (const event of events) {
    const bucket = byType.get(event.type) ?? [];
    bucket.push(event);
    byType.set(event.type, bucket);
  }

  const random = mulberry32(seed);
  const picked: CityEvent[] = [];
  const types = [...byType.keys()].sort();
  // Round-robin across types until we have enough, so every type is represented
  // before any type is over-represented.
  for (let round = 0; picked.length < count && round < 1000; round += 1) {
    let addedThisRound = false;
    for (const type of types) {
      if (picked.length >= count) break;
      const bucket = byType.get(type);
      if (bucket === undefined || bucket.length === 0) continue;
      const index = Math.floor(random() * bucket.length);
      const [chosen] = bucket.splice(index, 1);
      if (chosen !== undefined) {
        picked.push(chosen);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
  }

  return picked.sort((a, b) => a.t - b.t).map((event) => ({ event, local: localTime(event.t) }));
}

function table(rows: Sampled[]): string {
  const lines = [
    '| # | Local time (Newark) | Detected as | Callsign | Position | Alt (ft) | V/S (ft/min) | Our caption | ✅/❌ | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  rows.forEach(({ event, local }, index) => {
    const position = `${event.geo.lat.toFixed(4)}, ${event.geo.lon.toFixed(4)}`;
    lines.push(
      `| ${String(index + 1)} | ${local} | \`${event.type}\` | ` +
        `${event.attrs.callsign ?? '—'} | ${position} | ` +
        `${event.geo.alt_ft === null ? 'ground' : String(event.geo.alt_ft)} | ` +
        `${event.attrs.vrate_fpm === null ? '—' : String(event.attrs.vrate_fpm)} | ` +
        `${event.caption} | | |`,
    );
  });
  return lines.join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(`--${flag}`);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const count = Number(get('count', '20'));
  const dir = get('dir', 'data/recordings');
  const out = get('out', `docs/validation-${new Date().toISOString().slice(0, 10)}.md`);

  const files = readdirSync(dir)
    .filter((name) => name.includes('-event.'))
    .map((name) => join(dir, name));

  const events: CityEvent[] = [];
  for (const file of files) {
    for (const line of (await readRecording(file)) as { events?: unknown[] }[]) {
      for (const raw of line.events ?? []) {
        const parsed = eventSchema.safeParse(raw);
        // Simulated events are excluded: validating a replay against a flight
        // tracker would be checking our own recording against itself.
        if (parsed.success && !parsed.data.sim) events.push(parsed.data);
      }
    }
  }

  const rows = sample(events, count, 20261014);
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;

  const span =
    events.length > 1
      ? `${localTime(Math.min(...events.map((e) => e.t)))} → ${localTime(Math.max(...events.map((e) => e.t)))}`
      : 'n/a';

  writeFileSync(
    out,
    `# Detector validation — ${new Date().toISOString().slice(0, 10)}

SPEC §13's Phase 0 gate: spot-check 20 detected events against a public flight
tracker. **The verdict is Mohammad's** — §13 marks "detector precision looks right"
as a [HUMAN] judgement, and this file only brings him the evidence.

- Events available: **${String(events.length)}** (live only; simulated events excluded)
- Recording span: ${span}
- Type mix: ${Object.entries(counts)
      .map(([t, c]) => `\`${t}\` ${String(c)}`)
      .join(' · ')}
- Sampled: **${String(rows.length)}**, stratified by type so rare types are checked too

## How to check one row

1. Open a public flight tracker (FlightAware, Flightradar24, adsb.lol's own map) and
   search the callsign at that local time. For a row with no callsign the aircraft was
   private, so its identity was discarded on purpose (§3.2) — judge those from
   position, altitude and vertical speed alone.
2. Ask only: **was this event real, and is our label right?** A departure that was
   really a go-around is ❌. An arrival at Teterboro captioned as Newark is ❌. A real
   departure we labelled a departure is ✅, even if our altitude differs slightly.
3. Put ✅ or ❌ in the column and a short note. Leave it blank if you cannot tell —
   "could not verify" is a real answer and better than a guess.

Precision = ✅ ÷ (✅ + ❌). Ignore blanks in the ratio and say how many there were.

${table(rows)}

## Result

- ✅ \_\_\_ · ❌ \_\_\_ · could not tell \_\_\_
- Precision: \_\_\_ %
- **Go / no-go for Phase 1:** \_\_\_

### What to write down if something is wrong

Which rule misfired, and what the aircraft was actually doing. The thresholds all live
in \`config/sources.yaml\` and §3.2 says plainly they are starting values — so a ❌ is
a tuning input, not a failure, unless it points at a rule that is wrong in principle.
`,
  );
  console.log(`wrote ${out} with ${String(rows.length)} rows from ${String(events.length)} events`);
}

void main();
