# Phase 0 — Foundations: task breakdown

Target from SPEC §13: ≈ 2–3 days. Owner column names the subagent that should do the
work; **M** means Mohammad [HUMAN].

> **Gate (§13):** accept Phase 0 when the detector's precision looks right on spot
> checks **and** the lab renders a 10-minute WAV plus a report. Phase 1 does not
> start until both hold.

## The critical path is wall-clock, not work

Phase 0 requires **≥ 2 full days of recorded aircraft data** (§13). That is a
48-hour wait nothing can compress, and everything downstream — detector tuning,
the simulator, the lab's first real render — feeds on it. So the recorder ships
**first**, and the rest is built while it runs.

```
day 0  ├─ P0-1 scaffold ─┬─ P0-2 geo+places ─┬─ P0-3 collector+recorder ──▶ RECORDING STARTS
       │                 │                   └─ P0-4 docker (keeps it alive)
day 0–1│                 └─ P0-5 detector (tested on synthetic tracks)
day 1–2│                    P0-7 lab skeleton  ·  P0-6 simulator
day 2+ │  ◀── 48 h of real data lands here ──▶  P0-8 validate 20 events  ·  P0-9 first real render
day 2–3│                    P0-10 gate report
```

Sequential effort is ~1.5–2 days; the calendar is ~3 days because of the recording window.

---

## Tasks

### P0-1 · Toolchain scaffold — *implementer* · ~2 h
Repo layout per §5.1 (only the directories Phase 0 actually fills). Node 22 + ESM,
TypeScript **strict** on both sides, Vite client, one lint config, one test runner
(`node:test` or vitest — pick one and justify it in `docs/decisions.md`),
`.env.example`, `npm run dev|build|test|lint` at the root.
**Accept:** clean `npm install`, `lint` and `test` pass on an empty suite, `build`
emits, no `any` in the template files.

### P0-2 · Places config + geo math — *implementer* · ~2 h
`config/places.yaml` (NJIT origin, EWR, Penn Station, Prudential, Port Newark —
**values from `docs/verification.md`, not from SPEC's approximations**). A tiny geo
module: haversine distance, initial bearing, point-in-radius.
**Accept:** unit tests against hand-checked fixtures — NJIT→EWR distance and bearing
to ±1 % and ±1°, antimeridian and zero-distance edge cases, bearing sign convention
pinned by a test so nothing silently mirrors the stereo field later.
**Why first:** the collector and detector both depend on it, and a wrong bearing
convention would put every plane on the wrong side of the city.

### P0-3 · adsb.lol collector + normalizer + recorder — *implementer* · ~4 h
Poll per `config/sources.yaml` (10 s, jittered), timeout, exponential backoff on
429/5xx, honest `User-Agent` with contact [HUMAN — see questions], health state per
§3.5. Normalize to the §4 event schema. Keep a per-ICAO ring buffer of the last ~10
observations. Append **every normalized event and every raw poll** to
`data/recordings/YYYY-MM-DD.ndjson`.
**Accept:** runs 30 minutes unattended without an unhandled rejection; ndjson lines
validate against the schema; a forced 429 provokes real backoff (test with a stub,
never against the live API); killing the network leaves health `down` and recovers
without a restart; no tail numbers for non-airline aircraft anywhere in the file (§3.2).
**Note:** record the **raw** API response too, not just normalized events — the
detector thresholds in §3.2 are explicitly starting values to be tuned, and
re-tuning against normalized output only would mean re-recording for another 48 h.
*(Proposed addition to the spec — confirm.)*

### P0-4 · Docker + compose — *implementer* · ~1 h
Single Node service, `restart: unless-stopped` (§11.1), recordings on a mounted
volume, logs rotated, recordings capped at 30 days (§11.3).
**Accept:** `docker compose up -d` survives `docker kill` and a host reboot with the
ndjson intact and no duplicate or lost poll at the seam.
**Why here and not Phase 1:** it is what makes the 48-hour recording survive a crash.

### P0-5 · Event detector — *implementer* · ~5 h
`ewr_departure`, `ewr_arrival`, `overflight_city`, `helicopter` per §3.2, with
`heavy` as a modifier. Thresholds from `config/sources.yaml`. Fire-once semantics per
aircraft per event. **Derive direction from the data — never assume runway flow** (§3.2).
**Accept:** tests over hand-built synthetic tracks: a clean departure, a clean
arrival, a go-around (must not emit a false departure), a low overflight that is not
an EWR movement, a helicopter, an aircraft that disappears mid-climb, duplicate and
out-of-order observations, and a track that re-enters the radius (must not re-fire).
Replaying one recorded day emits a plausible count with no duplicate ids.

### P0-6 · Simulator + replay — *implementer* · ~3 h
`server/src/sim/` replays a recording at real time or faster, and generates synthetic
days from recorded statistics (§3.5). Everything it emits carries `sim: true`.
**Accept:** a replay of a recorded day reproduces the same event sequence
deterministically from a fixed seed; no emitted event is missing `sim: true`;
captions say "replay" (§3.5).

### P0-7 · Listening-lab skeleton + probe voice — *implementer* · ~7 h
**P0-7a · the interface (do this first, ~1 h).** Define the event→voice interface that
every Phase 1 voice will implement, and the master chain it feeds (compressor +
−1 dBTP limiter, §6.8). This is the one piece of Phase 0 audio design that is *not*
disposable — Phase 1's aircraft voices implement it — so it is worth getting right
and worth a reviewer pass of its own.

**P0-7b · the probe (~1 h).** `lab/fixtures/probe-voice.ts`: one bell per event,
quantized to the grid and panned by bearing, plus one sustained drone. First
implementation of the P0-7a interface, routed through the real master chain, **never
a bypass**. Excluded from the production client bundle.

**P0-7c · the renderer (~3 h).** `lab/render.ts`: Playwright + headless Chromium +
`Tone.Offline`, replaying a recording slice to a WAV, deterministic from a seed.
**Determinism is the hard part, not ffmpeg.** `Tone.Reverb` generates its impulse
response from `Math.random` noise, so it defeats bit-identical rendering: either keep
it out of the probe or install the seeded PRNG over `Math.random` **before any audio
node is constructed**. Audit the engine for every other `Math.random` and `Date.now`
— `Tone.Noise` textures included, since §6.2's rain and wind will use them.

**P0-7d · the analysis (~2 h).** `lab/analyze.py`: integrated LUFS, loudness range,
true peak (`ffmpeg -af ebur128`), spectrogram PNG (`ffmpeg showspectrumpic`), onset
density per minute. Report to `lab/reports/<date>-<preset>.md`.

**Accept:** a 10-minute render produces a report with real numbers and a viewable
PNG; **the same slice rendered twice gives an identical SHA-256**. Documented
fallback if exact identity proves impossible: max sample difference below −90 dBFS,
reason logged in `docs/decisions.md`. The hash is then recorded as the renderer's
**regression fixture** — a later mismatch means the renderer changed, not the music.
**Blocked on:** ffmpeg installed.

### P0-8 · Detector validation — *api-scout* (gather) + **M** (judge) · ~2 h
Pick 20 detected events spread across dayparts from the real recording; for each,
produce timestamp, callsign, position, altitude, vertical rate and our
classification, formatted for quick comparison against a public flight tracker.
**Accept:** a filled table in `docs/verification.md` and a stated precision figure.
**[HUMAN]:** "precision looks right" is your judgment (§13). I will bring the table
and a recommendation; the call is yours.

### P0-9 · First real render + report — *music-director* (reads) · ~1 h
Render a 10-minute slice of real recorded data, run the analysis, and have the music
director read the report and the spectrogram. Not for tuning yet — Phase 0 only
proves the loop works end to end.
**Accept:** `lab/reports/` holds one real report; the music director's first
observations are logged in `docs/music/decisions.md` as a Phase 1 starting point.

### P0-10 · Gate report — *me* · ~1 h
Re-read the §13 criteria, state pass or fail per criterion with evidence, list known
weaknesses, then **stop for your go/no-go**.

**Review:** *reviewer* runs on P0-2, P0-3, P0-5, P0-6 and P0-7 before each commit.
It has fresh eyes and no write access by design.

---

## Resolved: what Phase 0's lab renders ✅

§13 asked for the lab in Phase 0 but the audio engine in Phase 1, which was circular.
**Decided 2026-10-14: Phase 0 renders through a probe voice** (option 2 of three),
with three binding refinements — the probe implements the real event→voice interface
and real master chain, determinism traps (`Tone.Reverb`'s `Math.random` impulse
response above all) are handled with a bit-identical-render acceptance bar, and the
probe is demoted to a regression fixture rather than deleted. Full reasoning in
`docs/decisions.md`; SPEC §13 updated. See P0-7 above.

## Dependencies outside the code
- **ffmpeg** — not installed; P0-7 is blocked without it.
- **Contact email** for the `User-Agent` (§9.1) — P0-3 ships a placeholder until you
  give me one, and every poll we make until then is slightly impolite.
- **48 hours of uptime** on the recording laptop, starting whenever P0-3 lands.
