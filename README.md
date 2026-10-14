# Brick City Hum

**A live, browser-based radio that turns Newark into music.**

Planes leaving EWR, trains pulling into Newark Penn, the light rail under NJIT, the
weather over the city, the tide in Newark Bay and listeners tapping their screens all
become notes in one continuous ambient piece. Everyone, anywhere, hears the same piece
at the same moment — and every sound traces back to something that really happened in
the last few seconds.

A non-commercial project by Mohammad Dindoost with the NJIT Graduate Student Association.

> **Status: Phase 0 — foundations.** No audio yet. See
> [`docs/plan-phase0.md`](docs/plan-phase0.md) for what is being built and in what order.

## Documentation

| File                                           | What it holds                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`SPEC.md`](SPEC.md)                           | **The source of truth.** Vision, data sources, music system, phases. A living document — it changes as we learn. |
| [`CLAUDE.md`](CLAUDE.md)                       | Operating guide: conventions, the rules that get checked every session                                           |
| [`docs/plan-phase0.md`](docs/plan-phase0.md)   | Current phase, task by task                                                                                      |
| [`docs/verification.md`](docs/verification.md) | Every external API re-checked against the live source, with dates                                                |
| [`docs/decisions.md`](docs/decisions.md)       | What was decided, why, when                                                                                      |
| [`docs/music/`](docs/music/)                   | Music decisions, listening logs, palette rationale                                                               |

## Getting started

```bash
npm install
npm run setup          # enables the git hooks — do this once per clone
cp .env.example .env   # then fill in CONTACT_EMAIL
npm run check          # lint + typecheck + tests
npm run dev            # server on :8080, client on :5173
```

`npm run setup` is not optional. Git does not carry hook configuration in a clone, and
the pre-commit hook is what keeps email addresses out of this public repository.

| Script           | Does                                                            |
| ---------------- | --------------------------------------------------------------- |
| `npm run check`  | lint + format check + typecheck + tests — run before committing |
| `npm run dev`    | server and client together, both watching                       |
| `npm run build`  | typecheck, then build the client                                |
| `npm test`       | vitest once · `npm run test:watch` to watch                     |
| `npm run format` | rewrite with prettier                                           |

## How it is built

Node + TypeScript server polls every data source **once** and fans the results out
over WebSocket, so clients never call a third-party API and every listener stays in
sync. The browser renders sound with Tone.js and visuals with Canvas 2D. All musical
choices live in `config/*.yaml`, never in code, because the aesthetic is tuned
continuously and forever. Client randomness comes from a server-seeded PRNG so every
listener makes the same "random" choice and offline renders reproduce exactly.

Architecture and repo layout: [`SPEC.md` §5](SPEC.md).

## Sound and safety

Claude Code, which does much of the implementation here, **cannot hear audio**. So the
project includes a listening lab (`lab/`) that turns sound into things it can read —
loudness, onset density, pitch-class histograms, repetition scores, spectrogram images
— and **every musical change is decided by human ears**, in a blind A/B test logged in
[`docs/music/listening-log.md`](docs/music/listening-log.md). Numbers propose; people decide.

Two limits are never negotiable: **nothing flashes faster than 3 Hz** (photosensitive
epilepsy), and loudness stays around −20 LUFS integrated with a −1 dBTP ceiling.

## Data and attribution

All audio is synthesized or comes from **CC0** sample libraries (VCSL, VSCO 2 CE). No
copyrighted recordings, anywhere.

Aircraft data from [adsb.lol](https://adsb.lol) and [adsb.fi](https://adsb.fi); the
full source list, licences and required attributions are in
[`SPEC.md` §12](SPEC.md) and on the project's `/attributions` page.
**Privacy:** no accounts, no tracking, an aggregate listener count only. Airline
flights are shown by flight number and route; for private aircraft we show the type
and never the tail number or owner.

Not affiliated with NJ TRANSIT, the Port Authority, Amtrak, the NHL, or any airline.

## Licence

Code: MIT. Data from third-party sources remains under its own terms — see
[`docs/verification.md`](docs/verification.md).
