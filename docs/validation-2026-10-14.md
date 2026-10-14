# Detector validation — 2026-10-14

SPEC §13's Phase 0 gate: spot-check 20 detected events against a public flight
tracker. **The verdict is Mohammad's** — §13 marks "detector precision looks right"
as a [HUMAN] judgement, and this file only brings him the evidence.

- Events available: **56** (live only; simulated events excluded)
- Recording span: 14/10/2026, 15:41:17 → 14/10/2026, 16:20:48
- Type mix: `overflight_city` 5 · `helicopter` 2 · `ewr_arrival` 31 · `ewr_departure` 17 · `overflight_high` 1
- Sampled: **20**, stratified by type so rare types are checked too

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

| #   | Local time (Newark)  | Detected as       | Callsign | Position          | Alt (ft) | V/S (ft/min) | Our caption                           | ✅/❌ | Notes |
| --- | -------------------- | ----------------- | -------- | ----------------- | -------- | ------------ | ------------------------------------- | ----- | ----- |
| 1   | 14/10/2026, 15:41:52 | `helicopter`      | —        | 40.7516, -74.1481 | 900      | 128          | 🚁 a helicopter crossing Newark       |       |       |
| 2   | 14/10/2026, 15:41:52 | `overflight_city` | —        | 40.7516, -74.1481 | 900      | 128          | ✈ a helicopter over the city          |       |       |
| 3   | 14/10/2026, 15:47:29 | `ewr_arrival`     | ASA295   | 40.7344, -74.1381 | 900      | -832         | ✈ an airliner arriving at Newark      |       |       |
| 4   | 14/10/2026, 15:48:13 | `ewr_departure`   | UAL1021  | 40.6382, -74.2025 | 1850     | 640          | ✈ an airliner departing Newark        |       |       |
| 5   | 14/10/2026, 15:52:16 | `ewr_arrival`     | UAL1499  | 40.7373, -74.1361 | 950      | -832         | ✈ an airliner arriving at Newark      |       |       |
| 6   | 14/10/2026, 15:52:38 | `ewr_departure`   | UAL1498  | 40.6509, -74.1917 | 1525     | 1024         | ✈ an airliner departing Newark        |       |       |
| 7   | 14/10/2026, 15:53:27 | `helicopter`      | —        | 40.7039, -74.1681 | 125      | 256          | 🚁 a helicopter crossing Newark       |       |       |
| 8   | 14/10/2026, 15:55:01 | `overflight_city` | —        | 40.7217, -74.1756 | 625      | -64          | ✈ a helicopter over the city          |       |       |
| 9   | 14/10/2026, 15:55:40 | `overflight_city` | —        | 40.7567, -74.1594 | 800      | -64          | ✈ a plane over the city               |       |       |
| 10  | 14/10/2026, 15:56:08 | `ewr_departure`   | RPA5829  | 40.6630, -74.1841 | 1500     | 1280         | ✈ an airliner departing Newark        |       |       |
| 11  | 14/10/2026, 16:00:21 | `ewr_departure`   | UAL124   | 40.6464, -74.1977 | 1575     | 1088         | ✈ a heavy jet departing Newark        |       |       |
| 12  | 14/10/2026, 16:01:54 | `ewr_arrival`     | GJS4560  | 40.7383, -74.1356 | 1000     | -576         | ✈ a small jet arriving at Newark      |       |       |
| 13  | 14/10/2026, 16:02:28 | `overflight_city` | UAL124   | 40.7250, -74.1917 | 6450     | 2944         | ✈ a heavy jet over the city           |       |       |
| 14  | 14/10/2026, 16:08:24 | `ewr_arrival`     | UAL316   | 40.7266, -74.1431 | 725      | -512         | ✈ a large airliner arriving at Newark |       |       |
| 15  | 14/10/2026, 16:09:20 | `ewr_arrival`     | UAL2392  | 40.7324, -74.1395 | 825      | -704         | ✈ an airliner arriving at Newark      |       |       |
| 16  | 14/10/2026, 16:09:56 | `ewr_departure`   | RPA3584  | 40.6653, -74.1848 | 1550     | 1152         | ✈ an airliner departing Newark        |       |       |
| 17  | 14/10/2026, 16:10:40 | `overflight_high` | —        | 40.7441, -74.2111 | 41000    | 0            | ✈ a private jet high above Newark     |       |       |
| 18  | 14/10/2026, 16:13:59 | `ewr_arrival`     | GJS4508  | 40.7344, -74.1382 | 900      | -537         | ✈ a small jet arriving at Newark      |       |       |
| 19  | 14/10/2026, 16:14:23 | `overflight_city` | JZA497   | 40.7284, -74.2092 | 6100     | 1924         | ✈ an airliner over the city           |       |       |
| 20  | 14/10/2026, 16:19:30 | `ewr_departure`   | JBU685   | 40.6470, -74.1910 | 1800     | 1024         | ✈ an airliner departing Newark        |       |       |

## Result

- ✅ ___ · ❌ ___ · could not tell ___
- Precision: ___ %
- **Go / no-go for Phase 1:** ___

### What to write down if something is wrong

Which rule misfired, and what the aircraft was actually doing. The thresholds all live
in `config/sources.yaml` and §3.2 says plainly they are starting values — so a ❌ is
a tuning input, not a failure, unless it points at a rule that is wrong in principle.
