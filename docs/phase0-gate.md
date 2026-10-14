# Phase 0 gate report

> SPEC §13: _Accept when the detector's precision looks right on spot checks, and the
> lab renders a 10-minute WAV and a report._
>
> **Status: 5 of 7 criteria met. Two remain, and neither is code.**

Written 2026-10-14. Phase 1 does not start until this gate passes (§0).

## Criteria, one by one

| § 13 requirement                                                                   | Status                | Evidence                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo scaffold (§5.1), TypeScript server + Vite client, Docker, lint/test           | ✅                    | `npm run check`: lint, prettier, both typechecks, **223 tests**. `docker compose -p brick-city-hum up -d` runs it.                                                     |
| adsb.lol collector + recorder running                                              | ✅                    | Live since 15:14 EDT, 160 aircraft tracked, 0 write failures                                                                                                           |
| **Record at least 2 full days** of raw aircraft data                               | ⏳ **in progress**    | Started 2026-10-14 15:14 EDT → completes **2026-10-16 15:14 EDT**. ~91 MB/day measured. Wall clock; nothing can compress it.                                           |
| Event detector for `ewr_departure`, `ewr_arrival`, `overflight_city`, `helicopter` | ✅                    | Plus `overflight_high` and the `heavy` modifier. Replay of 32,701 real observations → 32 departures, 47 arrivals, 9 city overflights, 3 helicopters, 1 high overflight |
| …validated against the recordings (**spot-check 20 events**)                       | ⏳ **needs Mohammad** | Table ready: `docs/validation-2026-10-14.md`. §13 marks the verdict [HUMAN].                                                                                           |
| Simulator that replays recordings                                                  | ✅                    | `Replayer` + statistical `Simulator`, wired as §3.5's labelled last resort. Model built from real events; every emitted event carries `sim: true` and "(replay)"       |
| Listening-lab skeleton: offline render + LUFS + spectrogram                        | ✅                    | 10-minute WAV, **bit-identical across two renders**, report at `lab/reports/2026-10-14-phase0-probe.md` with a viewable spectrogram                                    |

## The two outstanding items

**1. The 48-hour recording.** Ends 2026-10-16 15:14 EDT. The detector thresholds in
`config/sources.yaml` are explicitly starting values (§3.2) and tuning them is what
this data is for.

**2. Your spot-check.** `docs/validation-2026-10-14.md` holds 20 events sampled
stratified by type — so the rare ones (helicopters, high overflights) are checked too,
which is where a detector is most likely to be wrong. The file explains how to check a
row. "Could not tell" is a valid answer and better than a guess.

## What the process actually caught

Worth recording, because it argues for keeping it rather than for anybody's diligence.

- **A privacy leak I had reported as verified.** Registrations were reaching
  append-only recordings through the `flight` field while `r` was correctly stripped —
  because for a private aircraft the callsign _is_ the registration. My verification
  missed it because the API space-pads the value and my regex was anchored on a
  closing quote. Of 100 aircraft over Newark, **26 carried callsigns shaped exactly
  like tail numbers**.
- **A climbing helicopter captioned "arriving at Newark"**, +896 ft/min, already on
  disk. One spurious `alt_baro: "ground"` flag was enough; 190 of 285 aircraft flipped
  at least once in 38 minutes.
- **A go-around guard that was wrong in both directions** — defeated by one bad ground
  flag, while its other branch needed >6,000 ft/min to be reachable and rejected a
  real departure.
- **A helicopter landing at a Jersey City heliport**, 3.2 nm away, captioned as
  Newark — found by the validation harness on its first run, before a human looked.
- **Six mutations that survived all 184 tests**, including deleting the arrival's
  distance check and the call that prevents an unbounded state leak.
- **`.env` was never being read**, so every outbound request was unattributable.
- **An HTTP 429 I caused myself** by restarting the container a dozen times in an hour.

Every one of these was found by replaying real recorded data or by a reviewer with no
knowledge of how the code was written. None was found by the tests as originally
written.

## Known weaknesses carried into Phase 1

- **52% of observations carry no vertical rate**, and absent is treated as zero — safe
  in the "do not fire" direction, but some real events are certainly missed. Measure
  against the full recording before tuning.
- **Routes are not enriched yet.** Captions are type-based ("an airliner departing
  Newark"). §3.2's amended rule — operator and route only when a route resolves _and_
  one endpoint matches the airport we observed — is designed and specified, not built.
- **`toPublicEvent` is not called by anything**, because there is no WebSocket yet. The
  allow-list is correct but unexercised at a real boundary.
- **The probe voice is not music** and its lab numbers must never be read as musical
  evidence. Phase 1's first real voice is the first thing in this project that may be.
- **SPEC §3.2 says "B2 helicopter"**; the ADS-B emitter set defines B2 as
  lighter-than-air. Config is right, that spec sentence is wrong — flagged, not
  silently corrected.

## Open questions from SPEC §15

Still unanswered, none blocking Phase 0: domain and GSA DNS (1), musician advisor (3),
class-change times (4), GSA wording (5), lounge screen (6). **(3) matters more than it
looks** — §7.2 makes human ears the bottleneck, not the model.

Two access requests are drafted and unsent in `docs/outreach.md` (OpenSky,
airplanes.live), plus attribution-wording queries that §12 needs before the Phase 1
attributions page.
