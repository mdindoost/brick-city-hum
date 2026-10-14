# CLAUDE.md — operating guide for brick-city-hum

`SPEC.md` is the source of truth. This file is the short version you read every
session; when the two disagree, SPEC.md wins and this file gets fixed.

**SPEC.md is a living document.** It is Mohammad's current thinking, not a frozen
contract. If something would give listeners a better experience, or reality
contradicts a spec assumption, **propose it and wait for his yes/no** — never
silently redesign, and never silently implement a line you believe is wrong.
Agreed changes: update SPEC.md, log the what/why/date in `docs/decisions.md`
(music changes in `docs/music/decisions.md`).

## The two stop signs

- **[HUMAN]** — needs Mohammad's decision or his ears. **Stop and ask. Do not guess.**
  Open items live in SPEC §15.
- **[VERIFY]** — researched but must be re-checked against the live source before
  any code depends on it. APIs and terms change. Findings go in
  `docs/verification.md` with the URL and date checked. A [VERIFY] that contradicts
  SPEC.md is **flagged, not quietly corrected**.

## Principles (§1) — in priority order

1. **Sound quality is the product.** Code that works but sounds bad is not done.
   The §7 music workflow is mandatory.
2. **You are standing at NJIT.** Everything is placed in space relative to campus:
   a plane departing south is heard from the south.
3. **Every sound is true.** Each note traces to a real event in the last seconds or
   minutes. Captions say what caused it. The only fill is labeled "memory" (§6.6) —
   derived from real events, never invented.
4. **Ambient, not background noise** (Eno): ignorable but interesting. Pleasant for
   hours, rewarding when you attend to it.
5. **Never silent, never chaotic.** The density governor holds the event rate in a
   comfortable band whatever the city does.
6. **Beauty is never done.** So: musical choices live in config, never in code.
7. **Zero friction** (no app, no login) and **zero licensing exposure** (synthesis or
   CC0 only).

## Repo layout (§5.1)

```
SPEC.md  CLAUDE.md
docs/decisions.md                      # what was decided, why, date
docs/music/{decisions.md, listening-log.md, palette.md}
docs/verification.md                   # [VERIFY] results, with URLs + dates
config/{score.yaml, sources.yaml, places.yaml}
server/src/{index,bus,governor,clock,ws,recorder,health}.ts
server/src/collectors/{adsb,opensky,adsbdb,njt,path,amtrak,openmeteo,metar,tide,ais,nhl}.ts
server/src/sim/{simulator,replay}.ts
client/src/main.ts
client/src/audio/{engine,mood,spatial,governor-client}.ts  client/src/audio/voices/*.ts
client/src/visual/{map,glyphs,captions}.ts
client/src/net/{socket,clocksync}.ts
client/public/samples/                 # CC0 only, each with a LICENSE note
lab/{render.ts, analyze.py, reports/}  # listening lab (§7.3)
.claude/agents/*.md
docker-compose.yml  Dockerfile
```

**One collector per source file, no shared cleverness between them.** §14's whole
fallback strategy (A1→A2→A3) depends on a source being swappable in isolation.

## Conventions

**TypeScript** — strict mode on, server and client. No `any` in committed code; if a
third-party shape is unknown, type it at the boundary and validate there. Node LTS
(v22 here). ESM. `ws` for WebSocket, Vite + Tone.js + Canvas 2D on the client —
no heavy UI framework.

**Config-as-data (§1.5, §5)** — every musical number lives in `config/score.yaml`,
polling intervals and detection thresholds in `config/sources.yaml`, coordinates and
stations in `config/places.yaml`. **A tuning value hard-coded in a `.ts` file is a
bug**, because the aesthetic is tuned forever after launch and the music director
must not need a code change to try an idea. Hot-reload config in development.

**Seeded randomness (§5)** — client randomness comes from a seeded PRNG; the seed is
the server's (epoch-minute + section id). Never `Math.random()` in anything audible
or visible: every listener must make the same "random" choice, and lab renders must
be reproducible from a seed.

**Shared clock (§9.4)** — the server stamps `play_at`; the client maps it to Tone.js
context time. Nothing audible is scheduled from local wall time.

**Server-only polling (§3)** — clients never call a third-party API. One poll, fanned
out over WebSocket. This is what keeps us inside rate limits and keeps listeners in sync.

**Rate-limit manners (§9.1)** — every collector: jittered interval, timeout,
exponential backoff on 429/5xx, real `User-Agent` with a contact address, health
reporting. Respect documented per-source caps (e.g. METAR ≤ 1 req/min per thread,
adsb.fi 1 req/s). Never hammer a free API we are a guest on.

**No secrets in git (§9.1)** — credentials in `.env` (gitignored); `.env.example`
lists the key names with empty values. **The repo is public** — before committing,
assume a stranger will read it. No keys, no tokens, no private addresses.

**Audio assets (§6.9, §12)** — synthesis first. Samples only from **VCSL** or
**VSCO 2 CE**, both **CC0**, each with a LICENSE note beside it in
`client/public/samples/`. Copyrighted audio never enters this repo, not even in a
scratch branch. Client sample budget < 15 MB, lazy-loaded per palette.

**Tests** — where logic breaks silently: geo math (bearing/distance), the aircraft
event-detection state machine, the density governor, clock-sync offset. Not on
glue code, not on anything whose correctness is "does it sound good" — that is §7's job.

## Hard safety rules — never negotiable

- **No flashing faster than 3 Hz, anywhere, ever** (§10, §14 — photosensitive
  epilepsy). Respect `prefers-reduced-motion`.
- **Loudness** stays at the §6.8 target (≈ −20 LUFS integrated, true peak −1 dBTP).
  Minimum ~5 ms attack on every voice. No sudden loud transients. No sustained
  energy above ~6 kHz.
- **Voice cap**: 24 desktop / 12 mobile, configurable. Degrade gracefully, don't
  underrun.

## Privacy (§3.2, §12)

- Airline flights: flight number and route are fine. **Non-airline aircraft: aircraft
  type only** (e.g. "a small private jet") — **never the tail number or the owner.**
- No accounts, no cookies beyond `localStorage` preferences, no analytics that
  identify anyone. Aggregate listener count only.
- Taps are anonymous and **never stored with any identifier**.
- Simulated or schedule-derived events must be flagged (`sim: true`,
  `scheduled: true`) and captioned honestly — never presented as live.

## Claude cannot hear (§7.2)

This is the project's central constraint. Judge sound only from: music theory, the
lab's numbers (LUFS, onset density, pitch-class histogram, repetition score, voice
counts), spectrogram **images**, and `docs/music/listening-log.md`. **Never write or
imply that you listened to anything.** Every musical change needs a human A/B win
(§7.5) before adoption.

## Working rhythm

Phase by phase (§13). Do not start a phase until the previous phase's acceptance
criteria pass. Run the **reviewer** agent on each meaningful change. Commit in small,
clearly-messaged steps. Stop at each phase gate and report.
