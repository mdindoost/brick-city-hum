# Brick City Hum — Project Specification

> **A live, browser-based radio that turns Newark into music.**
> Planes leaving EWR, trains pulling into Newark Penn, the light rail under NJIT, the weather over the city, the tide in Newark Bay, and students tapping their screens all become notes in one continuous ambient piece. Every listener, anywhere, hears the same piece at the same moment.

Repo: `brick-city-hum` · Owner: Mohammad (NJIT GSA) · Spec version: 1.0 (2026-10-14)

---

## 0. How to use this document (read first, Claude Code)

- This is the **source of truth** for the project. Read it fully before writing code.
- Work **phase by phase** (§13). Do not start a phase until the previous phase's acceptance criteria pass.
- Anything marked **[VERIFY]** was researched but must be re-checked against the live source before you depend on it (APIs and terms change).
- Anything marked **[HUMAN]** needs a decision or a listening judgment from Mohammad. Stop and ask; don't guess.
- Keep a running log in `docs/decisions.md` (what was decided, why, date). Keep music decisions separately in `docs/music/decisions.md`.
- **Sound quality is the product.** Code that works but sounds bad is not done. The music workflow in §7 is mandatory, not optional.

---

## 1. Vision and principles

1. **You are standing at NJIT, in the middle of Newark, and you can hear the whole city.** Sounds are placed in space relative to campus: a plane taking off to the south is heard from the south; a helicopter crossing to the east pans east.
2. **Every sound is true.** Each note traces back to a real event in the last few seconds or minutes. Captions say what caused it. Nothing is fake except clearly-labeled "memory" fill (§6.6).
3. **Ambient, not background noise.** In Brian Eno's sense: ignorable but interesting. It must be pleasant to leave on for hours and rewarding when you pay attention.
4. **Never silent, never chaotic.** A density governor keeps the event rate in a comfortable band regardless of what the city is doing.
5. **Beauty is never "done".** The aesthetic is tuned continuously after launch. All musical choices live in data/config, not hard-coded, so they can be tuned without rewrites.
6. **Zero friction.** Open a link, tap ▶, listen. No app, no login, no account.
7. **Zero licensing exposure.** All audio is synthesized or comes from CC0 samples. No copyrighted recordings anywhere.

---

## 2. Listener experience

### 2.1 Flow

1. Listener opens the URL (or scans a QR code on a GSA poster or lounge screen).
2. Landing screen: project name, one-line description, a large **▶ Listen** button, and a small hint: _"No sound on iPhone? Turn off Silent mode."_
3. Tap ▶ → audio starts (browsers require a user gesture). A short fade-in (3–5 s), never an abrupt start.
4. Main screen (dark theme):
   - **Stylized map of Newark** centered on NJIT. Aircraft as small glyphs with fading trails; rings bloom where events happen (station, runway, port).
   - **Caption ticker** (bottom): short human-readable lines, e.g. _"✈ United to Chicago departing EWR"_, _"🚇 Light rail arriving at Warren St/NJIT"_, _"🌧 Light rain began over Newark"_. Each caption appears in sync with its sound.
   - **Status bar** (top): local time, weather, listener count, a small "live" dot.
   - **Tap anywhere** on the map → the listener plays a note everyone hears (§8).
5. Optional controls: volume, mute individual layers (planes / trains / weather / people), "about this sound" panel, attributions link.

### 2.2 Lounge mode

- `?mode=lounge`: full-screen, larger captions, QR code in a corner, no controls, auto-recovers from disconnects, keeps the screen awake (Wake Lock API). For the GSA lounge TV.

### 2.3 Platform realities (must handle)

- **iOS Silent switch:** Web Audio is muted by the ringer switch by default. Since iOS 17, setting `navigator.audioSession.type = "playback"` makes Web Audio play like media. Do this inside the ▶ handler, feature-detected. Keep the on-screen hint anyway.
- **Backgrounding:** iOS (and some Android) suspend Web Audio when the tab is backgrounded or the phone locks. Accept this; this radio is primarily for laptops, desktops and the lounge screen. Detect suspension and show a "Tap to resume" overlay when the page returns.
- **Autoplay:** never attempt audio before the ▶ gesture.
- **Low-end devices:** cap simultaneous voices (§6.8). Degrade gracefully (fewer reverb sends, simpler synthesis) if the audio callback underruns.

---

## 3. Data sources

All sources are polled by the **server only**, once, and fanned out to every listener over WebSocket. Clients never call third-party APIs. This respects rate limits and keeps every listener in sync.

### 3.1 Summary table

| #   | Domain                                                                | Source                                                                                                                                                                                   | Access                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Poll                                 | Phase                  |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------- |
| A1  | Aircraft positions                                                    | **adsb.lol** `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}`                                                                                                                 | Keyless. Data under ODbL (attribution). Rate limit "dynamic"; a future key requirement is announced. [VERIFY]                                                                                                                                                                                                                                                                                                                                                                 | 10 s                                 | 1                      |
| A2  | Aircraft fallback                                                     | **adsb.fi** open data API (ADSBx v2 schema)                                                                                                                                              | 1 req/s, personal/non-commercial, attribution + link required. [VERIFY]                                                                                                                                                                                                                                                                                                                                                                                                       | on A1 failure                        | 1                      |
| A3  | Aircraft fallback 2                                                   | **OpenSky Network** `/api/states/all` with bbox                                                                                                                                          | OAuth2 client credentials (basic auth removed). Registered: 4,000 credits/day; small bbox ≈ 1 credit. **⚠ LICENCE-GATED: Terms §3(vi) require a written licence for any operational/live use, explicitly regardless of non-profit status.** Implemented behind a config flag, **disabled by default**, until OpenSky grants permission (requested 2026-10-14). Note §4(ii): their data must stay out of the permanent recordings even if granted. See `docs/verification.md`. | on A1+A2 failure, ≥ 25 s             | 1 (code) / gated (use) |
| A3b | Aircraft fallback candidate                                           | **airplanes.live** `GET /v2/point/{lat}/{lon}/{radius}`                                                                                                                                  | Was keyless; now returns **HTTP 403** asking for an emailed project description. Guide header says "Non-Commercial Use". Access requested 2026-10-14. Schema reportedly ADSBx v2-compatible, but `category` unconfirmed — §3.2's `helicopter`/`heavy` rules depend on it.                                                                                                                                                                                                     | if granted                           | 1–2                    |
| A4  | Flight route enrichment                                               | **adsbdb** `GET https://api.adsbdb.com/v0/callsign/{CALLSIGN}`                                                                                                                           | Free, keyless. Routes are inferred from callsign history and can be wrong for some carriers. **Cache in memory only, scoped to the aircraft's track lifetime — dropped when it leaves our radius, never written to disk** (§3.7). Without a cache we would send ~985,000 requests/day instead of ~1,500.                                                                                                                                                                      | on first sight of a callsign         | 1                      |
| R1  | NJ Transit rail (NEC, NJCL, M&E, Raritan into Newark Penn / Broad St) | NJT developer API + GTFS-RT (`raildata.njtransit.com`)                                                                                                                                   | Free registration and credentials. Terms: if data latency > 1 min, say it may not be real-time; **no NJT logos**.                                                                                                                                                                                                                                                                                                                                                             | 30 s                                 | 2                      |
| R2  | Newark Light Rail (incl. **Warren Street/NJIT**)                      | NJT bus/light-rail API (`pcsdata.njtransit.com`, mode `NLR`)                                                                                                                             | Same NJT credentials. [VERIFY endpoint names]                                                                                                                                                                                                                                                                                                                                                                                                                                 | 30 s                                 | 2                      |
| R3  | PATH (Newark ⇄ WTC)                                                   | Port Authority JSON `https://www.panynj.gov/bin/portauthority/ridepath.json` (station code `NWK`); alt: community `path.api.razza.dev`                                                   | Keyless, unofficial; may change without notice.                                                                                                                                                                                                                                                                                                                                                                                                                               | 15–30 s                              | 2                      |
| R4  | Amtrak at Newark Penn (`NWK`)                                         | Amtraker v3 `https://api-v3.amtraker.com/v3/stations/NWK`                                                                                                                                | Keyless community mirror; updates every few minutes.                                                                                                                                                                                                                                                                                                                                                                                                                          | 2–5 min                              | 2                      |
| W1  | Current weather                                                       | **Open-Meteo** `current=` + `minutely_15=` (HRRR 15-min data for the US)                                                                                                                 | Free for non-commercial use, attribution (CC BY 4.0). [VERIFY limits]                                                                                                                                                                                                                                                                                                                                                                                                         | 5 min (data changes per 15-min step) | 2                      |
| W2  | Airport observation                                                   | **aviationweather.gov** METAR for `KEWR` (JSON)                                                                                                                                          | Keyless, public. Max 100 req/min and **≤ 1 req/min per thread**. METAR is hourly plus specials (SPECI) on sudden changes; it reports thunderstorms (`TS`), rain, snow, fog, wind gusts.                                                                                                                                                                                                                                                                                       | 5 min                                | 2                      |
| S1  | Sun & moon                                                            | computed locally (`suncalc`)                                                                                                                                                             | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1 min                                | 2                      |
| T1  | Tide                                                                  | **NOAA CO-OPS** predictions, station **8530882 Port Elizabeth, Newark Bay** (subordinate station: predictions only). Optional observed water level: **8519483 Bergen Point West Reach**. | Keyless, public.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 30 min                               | 3                      |
| M1  | Ships                                                                 | **aisstream.io** WebSocket, bounding box over Port Newark/Elizabeth & Newark Bay                                                                                                         | Free API key; subscription message must be sent within 3 s of connecting; few concurrent connections per key. Free AIS is best-effort (minute-scale lag).                                                                                                                                                                                                                                                                                                                     | streaming                            | 3                      |
| C1  | Devils games at Prudential Center                                     | Unofficial NHL web API `https://api-web.nhle.com/v1/score/now`                                                                                                                           | Keyless, undocumented, can change between seasons. Poll politely, real User-Agent.                                                                                                                                                                                                                                                                                                                                                                                            | 30 s only during live NJD home games | 3                      |
| C2  | NJIT Highlanders home games                                           | njithighlanders.com schedule (Sidearm site; ICS export likely)                                                                                                                           | [VERIFY] whether an official ICS/JSON exists. Schedule only, no live data.                                                                                                                                                                                                                                                                                                                                                                                                    | daily                                | 3                      |
| C3  | NJIT class-change chime                                               | **manual config**: the most common class start/end times this semester                                                                                                                   | none; Mohammad provides times [HUMAN]                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                    | 3                      |
| C4  | NJIT campus events                                                    | No public feed found. [VERIFY]/[HUMAN] Defer.                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                    | later                  |
| P1  | Listener taps                                                         | our own WebSocket                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | realtime                             | 1                      |
| P2  | GSA Discord activity (count only, no content)                         | existing GSA bot posts a counter                                                                                                                                                         | [HUMAN] opt-in by GSA                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 1 min                                | later                  |

### 3.2 Aircraft: event detection (the heart of Phase 1)

Reference points (approximate; [VERIFY] with a map):

- **NJIT (listener origin):** 40.7420, −74.1790
- **EWR airport reference point:** 40.6925, −74.1687
- **Newark Penn Station:** 40.7345, −74.1638
- **Prudential Center:** 40.7335, −74.1711
- **Port Newark/Elizabeth (center):** ≈ 40.68, −74.15

Poll a circle around NJIT with radius ≈ 25 nm (covers EWR, Newark, Teterboro and LGA/JFK approaches overhead). Keep a per-aircraft track (keyed by ICAO hex) of the last ~10 observations.

Classify into these event types (thresholds are starting values; tune with recorded data in Phase 0):

| Event             | Rule (starting point)                                                                                                                            | Notes                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ewr_departure`   | Within 4 nm of EWR, altitude rises through 1,500 ft with vertical rate > +500 ft/min, and the previous observation was on ground or below 500 ft | Fire once per aircraft.                                                                                      |
| `ewr_arrival`     | Within 6 nm of EWR, descending below 1,000 ft with vertical rate < −300 ft/min, or a ground transition                                           | Fire once per aircraft.                                                                                      |
| `overflight_city` | Enters a circle of 3 km around NJIT (or a Newark city polygon) below 10,000 ft                                                                   | Fire on entry; continuous voice while inside (§6.4).                                                         |
| `overflight_high` | Passes within 3 km of NJIT above 10,000 ft                                                                                                       | Very soft; mostly texture.                                                                                   |
| `helicopter`      | ADS-B emitter category A7, any altitude < 3,000 ft within 5 km                                                                                   | Distinct timbre (§6.4). Measure how common helicopters actually are in the Phase 0 recordings before tuning. |
| `heavy`           | Category A5 (heavy) on any of the above                                                                                                          | Modifier: deeper, longer sound.                                                                              |

Do **not** assume which runway is in use or which direction traffic flows. Runway flow at EWR changes with the wind. Derive direction from the data.

**Privacy rule:** show airline flights by flight number and route. For non-airline aircraft (private, general aviation), show only the aircraft type (e.g. "a small private jet"), never the tail number or owner.

### 3.3 Rail: event detection

- Emit `train_arrival` / `train_departure` at Newark Penn, Newark Broad St, Warren St/NJIT and the other Newark Light Rail stations, and PATH Newark.
- Prefer actual or estimated times over scheduled times. Fall back to schedule (GTFS) only if real-time is unavailable, and mark the event `scheduled: true` so captions don't claim it's live (NJT terms require this when latency > 1 min).
- Line identity matters musically (§6.4): each line gets its own voice or pitch.

### 3.4 Weather, sky, water: slow state, not events

These set the **mood** (§6.2), not notes. Emit `state_change` messages when a value crosses a threshold (rain starts or stops, temperature band changes, sunset begins). Exception: thunderstorm onset (`TS` in METAR) and sunrise/sunset are **rare moments** (§6.7).

### 3.5 Source health and the simulator

- Every collector reports health (`ok`, `degraded`, `down`, last success time) to `/healthz` and to the admin page.
- **City simulator** (`server/sim/`): generates realistic synthetic events (statistical replay of recorded days). It is used for development, for tests, and as a labeled fallback if all real sources fail. Simulated events are always flagged `sim: true` and captioned as "replay".
- **Recorder:** every normalized event **and every raw API response** is appended to
  `data/recordings/YYYY-MM-DD.ndjson`, gzipped. **Measured 2026-10-14 against the
  live feed: ~27 MB/day for observations plus ~64 MB/day raw, so ~91 MB/day total**
  (~2.7 GB for the 30-day rolling window). An earlier estimate of 40–60 MB/day was
  low. The raw copy matters
  because §3.2's thresholds are explicitly starting values: tuning them against
  normalized output only would mean recording another two days from scratch every time.
  Recordings power the listening lab (§7) and the simulator.
- **Two kinds of recording, with very different lifetimes:**
  - **Rolling recordings** — everything the collectors see, kept 30 days then deleted
    automatically (§11.3). ~2.7 GB steady state, measured.
  - **Reference library** (`data/reference/`) — **permanent**, and the reason is §7.3:
    an A/B test is only meaningful if both renders get _identical_ input. Comparing
    palette A heard at 2 p.m. against palette B heard at 4 p.m. tells you nothing,
    because the city changed too. The same few slices, rendered forever, are also how
    a regression is caught — they answer "did the music change, or did the city?".
    A 30-minute slice is ~1 MB gzipped, so **8–10 slices cost ~10 MB for the life of
    the project**. Curate deliberately, and record _why_ each was kept:
    a busy weekday morning · a dead 3 a.m. · a thunderstorm (§6.7) · a snow day ·
    a holiday · a summer evening · a day with the EWR runway flow reversed.
    Since §1.5 makes tuning permanent and §13 Phase 4 is never closed, this library
    is permanent too.

### 3.6 Our own 1090 MHz receiver (option, Phase 3 — not decided)

Verification on 2026-10-14 found that free unconditional ADS-B access is closing
across the whole market (§14), which makes receiving the signal ourselves the only
option with **no licence question at all**: we would own the data, so no aggregator's
terms touch what we do with it musically. It also closes the §14 adsb.lol risk from
the other end — their API repo's README states _"In the future, you will require an
API key which you can obtain by feeding adsb.lol"_, and feeding is what earns it.

It fits §1.2 ("every sound is true") better than any API does: an antenna on an NJIT
roof hearing an aircraft directly is as close to the source as this project can get.

**Confirmed:**

- Software is free and open source: **`readsb`** (maintained fork of `dump1090`) plus
  **`tar1090`** for the map, both GPL-3.0. Feeding adsb.lol needs only "BEAST out on
  port 30005". Feeding several aggregators from one receiver is normal and documented.
- **No Raspberry Pi needed.** adsb.lol's own docs say any Debian-like Linux works, and
  §11.1 already puts an always-on laptop in place. Saves ~$60–80.
- A dongle with a **built-in 1090 MHz filter** (e.g. FlightAware Pro Stick Plus,
  $45.99, the one price confirmed) avoids buying a separate SAW filter. FlightAware
  themselves recommend filtering "in urban environments or with known high power radio
  transmitters nearby" — Newark, 12 km from Manhattan, is exactly that.
- **Radio horizon:** at a 25 nm radius a ground-level receiver reaches aircraft above
  roughly **413 ft** (d_nm ≈ 1.23·√h_ft). EWR traffic is above that except on the
  runway itself, so our radius is physically well within reach. **The limit is
  buildings, not altitude.**

**Not confirmed (deliberately not pinned down yet):**

- Antenna and cable prices. The FlightAware 26" antenna shows as discontinued at
  several retailers, the RTL-SDR Blog V4 kit is out of stock or retired everywhere
  checked, and remaining listings are foreign-currency or second-hand. **The market
  for these specific parts has thinned** — worth knowing before buying.
- Achieved range at NJIT specifically. Forum anecdotes only: ~300 nm from a high
  rooftop, 200–250 nm from an unobstructed window, 50–100 nm when blocked, ~10 nm
  from an interior room. No controlled test.
- Rooftop access from NJIT, and mast/weatherproofing/surge-protection costs.

**Decision deferred to Phase 3 by Mohammad**, with prices to be re-checked then —
today's figures will be stale by the time it matters. **This is a complement, never a
replacement:** one receiver needs line of sight and will miss low or distant aircraft,
so the network sources stay primary.

### 3.7 The normalizer boundary: privacy and caching

Two rules that are easy to state and easy to violate later, so they belong together
in one place.

**Strip identifying aircraft fields before anything leaves the collector.** §3.2
forbids tail numbers and owners for non-airline aircraft, and the upstream APIs do not
help us: adsb.lol and adsb.fi include `r` (registration) and `t` (type) in every
response, and adsbdb's `GET /v0/aircraft/{hex}` returns `type`, `registration` **and**
`registered_owner` together — there is no type-only endpoint. So the normalizer must
drop `registration`, `registered_owner*`, `mode_s` and photo URLs **before** the event
reaches the bus, a caption, a log line, or `data/recordings/`. The recordings are the
sharp edge: they are append-only and long-lived, so a leak there cannot be undone by
fixing the code afterwards. Keep the aircraft **type** — that is what §3.2 permits and
what the caption needs.

**Route lookups live in memory for as long as the aircraft does, and no longer.** Once
a plane has left our radius its route is of no further use to us, so it is dropped.
This is also why the cache exists at all: not to keep data, but to avoid asking
adsbdb the same question sixty times while one aircraft crosses the city.

A side effect worth noting: nothing is persisted, published, or incorporated into any
database, which makes adsbdb's route-data restriction moot without our having to
resolve its conflict with the repository's MIT licence (see `docs/verification.md`).

---

## 4. Event model

All collectors normalize into one schema:

```jsonc
{
  "id": "evt_01J...", // ULID
  "t": 1760458800123, // server epoch ms when the event happened (best estimate)
  "type": "ewr_departure", // see §3
  "source": "adsb.lol",
  "geo": { "lat": 40.69, "lon": -74.17, "alt_ft": 1600 },
  "rel": { "bearing_deg": 172, "distance_km": 5.6 }, // relative to NJIT, computed server-side
  "attrs": {
    "callsign": "UAL123",
    "category": "A3",
    "vrate_fpm": 2200,
    "route": { "from": "EWR", "to": "ORD" },
  },
  "salience": 0.7, // 0..1, used by the density governor
  "caption": "✈ United to Chicago departing EWR",
  "sim": false,
  "scheduled": false,
}
```

The server attaches a **musical timestamp** before broadcast: the event is scheduled for the next grid position on the shared transport (§9.4), at least 300 ms in the future, so every client plays it at the same moment.

---

## 5. Architecture

```
            ┌──────────── server (Node.js, TypeScript) ────────────┐
 APIs ──▶   │ collectors ─▶ normalizer ─▶ event bus ─▶ governor ─▶ │ ──WS──▶ browsers (Tone.js)
            │      │                         │                    │
            │   health                    recorder (ndjson)       │ ◀─WS── taps
            │                              state store (mood)     │
            └───────────────────────────────────────────────────────┘
                         │ HTTP: static client, /healthz, /admin, /attributions
                         ▼
                 cloudflared tunnel ──▶ public URL
```

- **Server:** Node.js LTS + TypeScript. `ws` for WebSocket. No database in Phase 1 (in-memory state + ndjson files). One process.
- **Client:** Vite + TypeScript + **Tone.js** (Web Audio) + Canvas 2D for visuals. No heavy UI framework.
- **Config-as-data:** `config/score.yaml` (musical parameters), `config/sources.yaml` (polling, thresholds), `config/places.yaml` (coordinates, stations). Hot-reload on change in development.
- **Determinism:** randomness in the client uses a seeded PRNG. The seed comes from the server (epoch-minute + section id), so all clients make the same "random" choices.

### 5.1 Repo layout

```
brick-city-hum/
  SPEC.md
  docs/decisions.md
  docs/music/{decisions.md, listening-log.md, palette.md}
  config/{score.yaml, sources.yaml, places.yaml}
  server/src/{index.ts, bus.ts, governor.ts, clock.ts, ws.ts, recorder.ts, health.ts}
  server/src/collectors/{adsb.ts, opensky.ts, adsbdb.ts, njt.ts, path.ts, amtrak.ts, openmeteo.ts, metar.ts, tide.ts, ais.ts, nhl.ts}
  server/src/sim/{simulator.ts, replay.ts}
  client/src/{main.ts, audio/{engine.ts, voices/*.ts, mood.ts, spatial.ts, governor-client.ts}, visual/{map.ts, glyphs.ts, captions.ts}, net/{socket.ts, clocksync.ts}}
  client/public/samples/   # CC0 only, with LICENSE notes
  lab/{render.ts, analyze.py, reports/}   # listening lab (§7)
  .claude/agents/music-director.md
  docker-compose.yml, Dockerfile
```

### 5.2 WebSocket protocol (JSON messages)

| Direction | `type`          | Purpose                                                                                |
| --------- | --------------- | -------------------------------------------------------------------------------------- |
| S→C       | `hello`         | server time, current mood state, transport (bpm, epoch), seed, section, listener count |
| C→S / S→C | `ping` / `pong` | clock sync (§9.4)                                                                      |
| S→C       | `event`         | one normalized event + `play_at` (server ms)                                           |
| S→C       | `mood`          | slow-state update (weather, daypart, tide, section change)                             |
| C→S       | `tap`           | `{x, y, dept?}` normalized 0..1 coordinates                                            |
| S→C       | `tap`           | rebroadcast tap with `play_at` and anonymous session color                             |
| S→C       | `stats`         | listener count, per-source health (lightweight)                                        |

---

## 6. Music system (the score)

> Starting design. Every number here is a default for the music director to tune (§7). Store them in `config/score.yaml`.

### 6.1 Layers

| Layer           | Role                                                                  | Driven by                                                                   |
| --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Ground**      | Continuous drone or pad, the "air" of the city                        | daypart, weather, tide (very slow)                                          |
| **Color**       | Slow-moving harmonic bed and texture (rain grain, wind filter sweeps) | weather, sun/moon                                                           |
| **Pulse**       | Very soft shared clock; mostly felt, rarely heard                     | transport (fixed BPM per section)                                           |
| **City voices** | Notes and phrases from events                                         | aircraft, rail, ships, sports                                               |
| **People**      | Listener taps                                                         | P1                                                                          |
| **Moments**     | Rare, special, memorable gestures                                     | sunrise/sunset, storm onset, Devils goal, first flight of the morning, etc. |

### 6.2 Mood: harmony and timbre from slow state

- **Daypart palettes** (six): late night, dawn, morning, afternoon, evening, night. Each defines a mode or scale family, a register range, brightness (filter cutoff), reverb size, and the default instrument set. Transitions crossfade over 5–10 minutes. Never jump.
- **Weather modifiers:** clear → brighter, more open intervals; overcast → darker filter, closer voicings; rain → add a granular "rain" texture whose density follows precipitation rate; snow → softer attacks, longer reverb; fog/low visibility (from METAR) → heavy low-pass; wind gusts → slow filter sweeps on the Color layer; temperature band → nudges register (warmer = slightly higher).
- **Harmonic motion:** a slow chord or drone-center drift (one change every 1–4 minutes), chosen from the current palette with a seeded Markov walk. All event notes are **quantized to the current scale**. No wrong notes, ever.

### 6.3 Time and rhythm

- One shared **transport** per section (e.g. 60–80 BPM), slow enough that quantization feels natural.
- Events are snapped to the next 8th or 16th note on the grid (configurable per voice) so the city "falls into" the music.

### 6.4 Mapping events to sound (starting design)

**Spatialization (core to "you are at NJIT"):**

- Bearing from NJIT → stereo pan (default), or binaural/HRTF via `Tone.Panner3D` when the listener enables "headphones mode".
- Distance → gain, low-pass cutoff and reverb send (farther = quieter, darker, wetter).
- Altitude → register (lower altitude = lower and closer).

**Aircraft:**

- `ewr_departure`: a rising 2–3 note figure; climb rate sets glide speed. Heavy aircraft get a lower, longer, warmer voice (bowed or low-brass-like sample or synth).
- `ewr_arrival`: a falling figure, softer attack.
- `overflight_city`: a sustained tone that follows the aircraft while inside the 3 km circle. Pan moves with it; a very slight pitch bend on approach and retreat (Doppler-like, subtle).
- `helicopter`: a soft tremolo/flutter texture, panned and moving.
- `overflight_high`: barely audible shimmer.

**Rail:**

- Each line has its own bell or chime pitch set (e.g. PATH = one bell, Light Rail = another, NJT lines and Amtrak = a third family). Arrivals = struck note; departures = the same note with a short decay tail.
- **Warren St/NJIT** light-rail arrivals get a signature motif: it's "our" stop.

**Ships (Phase 3):** very low, long horn-like swells, rare and spacious.

**Sports (Phase 3):** a Devils goal at the Prudential Center triggers a short celebratory motif (a bright chord flourish) within the scale, with a caption.

**Class change (Phase 3):** a gentle campus chime at configured times.

### 6.5 Density governor (prevents chaos and silence)

- **Target band** of audible events per minute, per daypart (e.g. night 2–6, day 6–14; tune).
- **Too many** (rush hour): keep the highest-salience events, merge near-simultaneous events of the same type into one gesture, demote the rest to quiet texture.
- **Too few** (3 a.m.): use **memory fill** (§6.6) and let the Ground and Color layers carry more.
- The governor runs **server-side** (authoritative, same for everyone). The client has a safety limiter on top.

### 6.6 Memory fill (honest silence-filling)

When the city is quiet, the system softly replays motifs derived from events of the last hour, transformed (augmented, inverted, in a distant register). Captions mark them as echoes, e.g. _"…an echo of the 2:14 arrival from Atlanta"_. True to principle 2: nothing is invented.

### 6.7 Anti-monotony toolkit (mandatory)

The biggest risk is boredom after 10 minutes. Use all of these:

1. **Incommensurate loops.** Ground and Color layers are built from several loops of unequal, mutually prime lengths (e.g. 17 s, 23 s, 31 s), so the combination effectively never repeats. This is the technique behind Eno's _Music for Airports_.
2. **Slow LFOs with prime periods** on filter, pan and level.
3. **Sections:** every 8–20 minutes the transport, palette sub-variant and instrument set shift (seeded), with smooth transitions.
4. **Micro-variation:** humanized timing (±10–25 ms), velocity, timbre jitter, and sample round-robin.
5. **Rare moments** (§6.1) give memorable peaks: sunrise, sunset, first departure after the overnight lull, storm onset, a Devils goal, the moon rising.
6. **Weekly and seasonal drift:** a weekly seed and slow seasonal palette shift, so Monday sounds different from Saturday.
7. **Real data variety:** the more independent sources, the less predictable the result. This is why Phases 2–3 add rail, weather, tide, ships and campus/city events.

### 6.8 Mix and safety rules

- Master chain: gentle compression + true-peak limiter at −1 dBTP.
- Loudness target: around −20 LUFS integrated for comfortable background listening ([HUMAN] tune by ear; measure in the lab).
- Tame harshness: no sustained energy above ~6 kHz; gentle high-shelf cut.
- Max simultaneous voices: 24 desktop / 12 mobile (configurable). Voice stealing prefers the oldest, least salient voice.
- No sudden loud transients. Every event voice has a minimum attack of ~5 ms.

### 6.9 Sound sources

- **Synthesis first** (Tone.js synths, FM, filtered noise, granular textures).
- **Samples:** **VCSL** (Versilian Community Sample Library) and **VSCO 2 CE**, both **CC0**. Use a small curated subset (bells, mallets, bowed strings, a piano, soft winds). Convert to compressed formats; keep the client download small (target < 15 MB total, lazy-loaded by palette).
- Never use copyrighted loops or recordings.

---

## 7. Music direction workflow (critical)

### 7.1 Roles

- **Human Music Director: Mohammad** [HUMAN]. Final say on everything that is heard.
- **Human musician advisor (recruit)** [HUMAN]: a student musician (via GSA or campus music groups) who listens weekly and gives feedback on harmony, timbre and mix. Strongly recommended.
- **Listener panel:** 5–10 friends who do short blind A/B tests.
- **Claude music-director subagent:** designs palettes, mappings and variations, and analyzes lab reports. It proposes; humans approve.

### 7.2 Important limitation

Claude Code **cannot hear audio**. It can only reason about music theory, read numeric analyses and look at images (spectrograms, plots). Therefore the project must include a **listening lab** that turns sound into things Claude can read, and every musical decision must be **confirmed by a human listening test**.

### 7.3 Listening lab (`lab/`)

1. **Record** real city days (§3.5) as ndjson.
2. **Render offline:** replay a recording (e.g. a 30-minute slice at any time of day) through the exact client audio engine in headless Chromium (Playwright) using `Tone.Offline`, producing a WAV. Deterministic seed → reproducible.
3. **Analyze** (`lab/analyze.py`, ffmpeg + librosa or numpy):
   - Integrated loudness (LUFS), loudness range, true peak (`ffmpeg -af ebur128`).
   - Spectrogram PNG (`ffmpeg showspectrumpic`), which Claude can view.
   - Onset density per minute (event rate actually heard).
   - Pitch-class histogram (is it stuck on the same notes?).
   - Self-similarity / repetition score over 10-minute windows (catches loop fatigue).
   - Count of simultaneous voices (max, p95).
4. **Report:** `lab/reports/<date>-<preset>.md` with numbers and images. The music-director subagent reads it and proposes specific parameter changes.
5. **Human A/B:** for every proposed change, render A and B from the same recording; the panel rates each 1–5 on _pleasant_, _alive_, _annoying_, _would leave it on_. Log results in `docs/music/listening-log.md`. Only adopt changes that win.

### 7.4 Subagent definition

Create `.claude/agents/music-director.md`:

```markdown
---
name: music-director
description: Designs and critiques the sound of Brick City Hum — palettes, harmony, data-to-sound mappings, mix — using lab reports. Proposes changes as diffs to config/score.yaml; never claims to have heard audio.
model: opus
---

You are the music director for Brick City Hum, a generative ambient radio driven by live Newark data.
Goals, in order: (1) pleasant for hours, (2) alive and surprising when attended to, (3) every sound traceable to a real event.
You cannot hear. Base judgments on music theory, the lab's numeric analyses and spectrogram images, and human listening logs.
Always: propose small, testable changes; state the expected audible effect; request a human A/B before adoption.
Never: introduce copyrighted material; raise loudness above target; add fast flashing visuals.
```

Model choice: use the most capable model available on the account for this agent. Default `opus` (Claude Opus 5.5). If the account offers `fable` (Claude Fable 5.1), try it for this role and compare the quality of its proposals. Implementation work can stay on the default model. The bottleneck is human ears, not the model.

### 7.5 Cadence

- Phase 1–2: a listening session at least twice a week.
- After launch: weekly. The sound is never declared final.

---

## 8. Listener taps (people layer)

- **No login.** Anyone, on or off campus, can play. Login would add friction for little benefit; abuse stakes are low.
- **Optional identity:** a one-time picker "Which department are you in?" (stored in `localStorage`), with a **"Newark / Guest"** option for outsiders. The department sets the color of that listener's circles. No accounts, no verification.
- **Mapping:** tap x → pitch within the current scale (always consonant); tap y → register or instrument family (top = bells, bottom = soft piano); distance from screen center → pan.
- **Feel:** play locally immediately (optimistic), then broadcast; others hear it on the next grid step (quantized). The sender's own circle gets an outline ring.
- **Limits (server-enforced):** 1 tap per 2 s per connection; a per-IP ceiling; a global ceiling (e.g. 8 taps/s total; excess dropped by recency). Taps are never stored with any identifier.
- **Lounge display** shows a playful "who's playing" color bar by department (aggregated counts only).

---

## 9. Server details

### 9.1 Collectors

- Each collector: polling interval with jitter, timeout, exponential backoff on 429/5xx, `User-Agent: brick-city-hum (contact: <GSA email>) [HUMAN]`, health reporting.
- Secrets in `.env` (NJT credentials, OpenSky client id/secret, aisstream key). Never commit secrets.

### 9.2 Governor

Server-side, as in §6.5. Outputs the final event stream with `play_at` timestamps.

### 9.3 State store

Current mood (daypart, weather, tide, section, seed), last N events per type (for memory fill and captions), listener count.

### 9.4 Clock sync

- On connect and every 30 s: the client sends 5–8 pings, keeps the sample with the lowest round-trip, and estimates offset = server_time − (t_send + rtt/2).
- The client maps `play_at` (server ms) to Tone.js context time.
- Target: listeners within ~50 ms of each other. That is sufficient for an ambient piece.

### 9.5 Admin page (`/admin`, password-protected)

Source health, live event rate, governor stats, listener count, current section and palette, buttons to force a section change or a palette preview, and hot-reload of `score.yaml`.

---

## 10. Visual design

- Dark, calm, minimal. A stylized vector outline of Newark (rivers, major roads, EWR runways, rail lines) drawn from OpenStreetMap-derived data with proper attribution, or hand-simplified geometry. No paid map tiles.
- Glyphs: aircraft (small chevrons with fading trails), trains (pulses along rail lines), ships (slow dots), taps (colored circles).
- Rings bloom on events, sized by salience, fading over 2–4 s.
- **Accessibility:** respect `prefers-reduced-motion`. **No flashing faster than 3 Hz, ever** (photosensitive epilepsy). Captions are readable at high contrast. Captions double as a text alternative to the audio.
- Lounge mode: larger type, QR code, slow ambient camera drift.

---

## 11. Hosting and operations

### 11.1 Phase A: Quick Tunnel (now)

- Run the server on Mohammad's always-on laptop, in Docker with `restart: unless-stopped`.
- Expose with `cloudflared tunnel --url http://localhost:<port>`.
- Known Quick Tunnel limits: no uptime guarantee, a **new random URL on every restart**, a hard limit of **200 in-flight requests** (beyond that, HTTP 429), and **no Server-Sent Events**. WebSockets work, and this design uses WebSockets, not SSE. It is unclear whether each open WebSocket counts against the 200 in-flight limit [VERIFY]; assume the worst case and plan for **at most ~150 concurrent listeners** in Phase A.
- Fine for development and friend testing. Not for a public launch.

### 11.2 Phase B: Named tunnel + domain (launch)

- Create a named Cloudflare Tunnel (free account) with a stable hostname.
- Domain options [HUMAN]: (a) buy a domain (~$10–15/yr) and put it on Cloudflare DNS; or (b) use a GSA domain or subdomain. For (b), the hostname's DNS must be managed by Cloudflare for a tunnel route. If GSA's DNS lives elsewhere, either move it, or have the GSA domain redirect to the project domain. [VERIFY with whoever manages GSA DNS]
- Run `cloudflared` as a system service.

### 11.3 Laptop as a server: checklist

- Disable sleep and lid-close sleep.
- Docker restart policy plus `cloudflared` as a service, so everything comes back after a reboot.
- Schedule OS auto-update reboots for ~4 a.m.
- Battery charge limit (~80%) if supported. The battery then doubles as a UPS.
- Wired Ethernet if possible.
- External uptime monitor (e.g. UptimeRobot free) on the public URL + `/healthz`, with email alerts.
- Logs rotated. Rolling recordings capped at 30 days (§3.5). **`data/reference/` is exempt from the cap and never auto-deleted** — it is ~10 MB and every future A/B test and regression check depends on it.
- Only the app port is exposed through the tunnel; `/admin` behind a password.

---

## 12. Legal, attribution, privacy

- **/attributions page** listing: adsb.lol (ODbL), adsb.fi (attribution + link), OpenSky Network, adsbdb, NJ TRANSIT (no logos; real-time disclaimer when applicable), Port Authority PATH data, Amtraker, Open-Meteo (CC BY 4.0), NOAA CO-OPS and aviationweather.gov (US government), aisstream.io, NHL data (unofficial), VCSL/VSCO 2 CE (CC0), OpenStreetMap contributors (ODbL). [VERIFY each source's exact attribution wording]
- **Non-commercial** use only, consistent with the free tiers above.
- **Privacy:** no accounts, no cookies beyond `localStorage` preferences, no analytics that identify people (an aggregate listener count only). No tail numbers or owners for private aircraft. Taps are anonymous and not stored with identifiers.
- Not affiliated with NJ TRANSIT, the Port Authority, Amtrak, the NHL, or the airlines. Say so on the about page. NJIT/GSA affiliation wording per GSA [HUMAN].

---

## 13. Phases and acceptance criteria

### Phase 0: Foundations (≈ 2–3 days)

- Repo scaffold (§5.1), TypeScript server + Vite client, Docker, lint/test.
- adsb.lol collector + recorder running; **record at least 2 full days** of raw aircraft data.
- Event detector for `ewr_departure`, `ewr_arrival`, `overflight_city`, `helicopter`, validated against the recordings (spot-check 20 events manually against a public flight tracker).
- Simulator that replays recordings.
- Listening-lab skeleton: offline render + LUFS + spectrogram. The engine does not
  exist yet in Phase 0, so the lab renders through a **probe voice**: one bell per
  event panned by bearing, plus a single drone. It is the **first implementation of
  the event→voice interface** that Phase 1's real voices implement, and its output
  goes through the planned master chain (compressor + −1 dBTP limiter) — the harness
  must exercise the same path real voices will use, never a bypass.
  The probe lives at `lab/fixtures/probe-voice.ts`, is excluded from the production
  client bundle, and is kept afterwards as the renderer's **regression fixture**
  (a known-hash check that answers "did the renderer change, or did the music?").
  It is a measurement fixture, **not a musical artifact, and is never tuned.**
- ✅ _Accept when:_ detector precision looks right on spot checks; the lab renders a
  10-minute WAV and a report; **the same slice rendered twice is bit-identical
  (matching SHA-256)**. If exact identity is impossible for a documented reason, the
  fallback bar is a max sample difference below −90 dBFS, with the reason recorded in
  `docs/decisions.md`.

### Phase 1: MVP, "planes + people" (≈ 1 week)

- Clock sync, transport, Ground layer, aircraft voices, spatialization, density governor, taps, captions, minimal map.
- iOS audio-session handling, start screen, reduced-motion support.
- Quick Tunnel deployment on the laptop.
- First listening sessions (§7); at least 3 A/B rounds.
- ✅ _Accept when:_ 10–20 testers on different devices hear it in sync; nobody reports harshness; the panel's median "would leave it on" ≥ 3.5/5. **[HUMAN] Go/no-go decision.**

### Phase 2: The city wakes up (≈ 1–2 weeks)

- Rail (NJT rail, Newark Light Rail incl. Warren St/NJIT, PATH, Amtrak), weather (Open-Meteo + METAR), sun/moon, daypart palettes, weather modifiers, memory fill, sections, full anti-monotony toolkit, lounge mode, admin page, attributions page.
- ✅ _Accept when:_ a 24-hour offline render shows no 10-minute window with a high repetition score; loudness stays within ±2 LU of target; the panel prefers Phase 2 over Phase 1 in blind A/B.

### Phase 3: Newark and NJIT character (≈ 1–2 weeks)

- Tide, ships (AIS), Devils goals, NJIT home games, class-change chime, rare moments, headphones (HRTF) mode.
- Named tunnel + domain; uptime monitoring; public launch with GSA (posters with QR, lounge screen).
- ✅ _Accept when:_ stable for 7 days with > 99% uptime on the monitor; launch checklist done [HUMAN].

### Phase 4: Maturation (ongoing, never closed)

- Weekly listening sessions, palette additions, seasonal variants, new data sources as discovered, community suggestions.

---

## 14. Risks and mitigations

| Risk                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sound becomes monotonous                                 | §6.7 toolkit, more data sources, listening lab repetition metric, weekly human sessions                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Sound is unpleasant or harsh                             | mix rules §6.8, human musician advisor, A/B gating                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A free API changes, rate-limits or disappears            | fallback chain for aircraft (**A1→A2→simulator** while A3 is licence-gated and A3b is pending); simulator fallback; health monitoring; adapters isolated per source                                                                                                                                                                                                                                                                                                                                                                                    |
| **Free ADS-B access is closing across the whole market** | Verified 2026-10-14: OpenSky needs a written licence, airplanes.live now gates on request, ADS-B Exchange's commercial-licence wording covers non-profits, Flightradar24 is economically out (~8.6× its cheapest tier at our polling rate), and adsb.lol's own README says a key _will_ be required, earned by feeding them. This is not a per-source risk but a structural one. Mitigation: keep adapters swappable, keep the simulator honest, and treat **our own 1090 MHz receiver** as the licence-free endgame — it also earns the adsb.lol key. |
| adsb.lol introduces API keys                             | budget time to register/feed; adsb.fi + OpenSky fallbacks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Quick Tunnel URL changes on restart                      | Phase A is for testing only; move to a named tunnel before any public promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| > ~150 concurrent listeners on Quick Tunnel              | named tunnel in Phase B                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| iOS mutes or suspends audio                              | `audioSession.type="playback"`, on-screen hints, resume overlay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Laptop downtime                                          | restart policies, uptime monitor, charge limit; VPS is the fallback (~$5–12/mo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Route enrichment wrong (adsbdb)                          | show the route only when confident; otherwise caption by airline only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Photosensitivity                                         | hard cap of 3 Hz on any flashing; reduced-motion mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 15. Open questions for Mohammad [HUMAN]

1. Domain: buy one, or use a GSA domain? Who manages GSA DNS?
2. Contact email for the User-Agent and attributions page.
3. Musician advisor: anyone in mind?
4. Class change times for the chime (or skip it).
5. GSA approval wording and logo use on the page.
6. Lounge screen: is there one we can use, and who controls it?

---

## Appendix A: Key references

- Cloudflare Quick Tunnels (limits): https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- OpenSky REST API (OAuth2, credits): https://openskynetwork.github.io/opensky-api/rest.html
- adsb.lol API source and notes: https://github.com/adsblol/api · docs: https://api.adsb.lol/docs
- ADS-B API comparison (limits and terms snapshot, Sept 2026): https://flyitalyadsb.com/en/dati/confronto/
- adsbdb: https://www.adsbdb.com
- NJ TRANSIT developer terms: https://developer.njtransit.com/terms/
- PATH data (community API): https://github.com/mrazza/path-data
- Amtraker v3 (via `amtrak` npm package docs): https://www.npmjs.com/package/amtrak
- aviationweather.gov Data API: https://aviationweather.gov/data/api/
- Open-Meteo (HRRR / 15-minutely): https://open-meteo.com/en/docs/gfs-api
- NOAA CO-OPS station 8530882 (Port Elizabeth, Newark Bay): https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=8530882
- aisstream.io docs: https://aisstream.io/documentation
- NHL web API reference (unofficial): https://github.com/Zmalski/NHL-API-Reference
- WebKit: Web Audio and the Silent switch, `navigator.audioSession`: https://bugs.webkit.org/show_bug.cgi?id=237322
- VCSL (CC0 samples): https://github.com/sgossner/VCSL · VSCO 2 CE: https://versilian-studios.com/vsco-community/
- Warren Street/NJIT station: https://en.wikipedia.org/wiki/Warren_Street/NJIT_station
- Inspiration: Listen to Wikipedia (listen.hatnote.com); Brian Eno, _Ambient 1: Music for Airports_ (1978), for the unequal-loop technique.
