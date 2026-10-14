# Detector validation — 2026-10-14

SPEC §13's Phase 0 gate: spot-check 20 detected events against a public flight
tracker. **The verdict is Mohammad's** — §13 marks "detector precision looks right"
as a [HUMAN] judgement, and this file only brings him the evidence.

- Events available: **56** at sampling time (live only; simulated events excluded)
- Recording span sampled: 14/10/2026, 15:41:17 → 16:20:48 (America/New_York)
- Type mix: `overflight_city` 5 · `helicopter` 2 · `ewr_arrival` 31 · `ewr_departure` 17 · `overflight_high` 1
- Sampled: **20**, stratified by type so rare types are checked too

## Where to look on a tracker

Two things make this harder than it sounds, and both have simple answers.

**Trackers work in UTC; our table is Newark local time.** On 14 October, Newark is
UTC−4, so **local + 4 h = UTC**. 15:41 EDT is 19:41Z. The UTC column below is already
converted — use it.

**History is time-limited on the free tier.** Flightradar24 gives free accounts
**7 days** of history ([support.fr24.com](https://support.fr24.com/support/solutions/articles/3000115499-is-it-possible-to-see-playback-of-past-flights-)),
so this table must be checked **before 21 October 2026**. After that the free window
closes and these rows can no longer be verified at all.

Three ways in, cheapest first:

1. **A named flight** — open
   `https://www.flightaware.com/live/flight/<CALLSIGN>` (the ICAO callsign exactly as
   in the table, e.g. `UAL1021`) or
   `https://www.flightradar24.com/data/flights/<iata>` (e.g. `ua1021`). Both show the
   last few days of that flight number: date, origin, destination, actual times. Ask
   only whether a flight with that number really was taking off from, or landing at,
   Newark in that minute.
2. **An unnamed aircraft** — these are private aircraft whose identity we discard on
   purpose (§3.2), so there is nothing to search for. Use Flightradar24's **Global
   Playback**: set the date to 14 Oct 2026 and the time to the row's **UTC** value,
   centre the map on the row's coordinates, and look for an aircraft at that altitude.
   Judge it from position, altitude and climb rate.
3. **Newark's own movements** — `https://www.flightradar24.com/data/airports/ewr`
   lists arrivals and departures with actual times, which settles the ✈ rows in bulk
   without opening one page per flight.

### What to ask of each row

Only this: **was this event real, and is our label right?** A departure that was
really a go-around is ❌. An arrival at Teterboro captioned as Newark is ❌. A real
departure we labelled a departure is ✅, even if our altitude differs slightly.
Leave the cell blank if you cannot tell — "could not verify" is a real answer and
better than a guess.

Precision = ✅ ÷ (✅ + ❌). Ignore blanks in the ratio and say how many there were.

## What could be settled without a tracker

Before the table goes to a human, two checks that need no subscription were run, so
that the human effort lands on the rows that genuinely need eyes.

**1. An independent schedule database** was queried for each callsign, and compared
with the airport and direction we detected. It is **date-less** — it holds one leg of
a flight number, not that day's flight — so it can confirm, never refute. Its answers
appear in the _Independent_ column, and the routes themselves are deliberately not
stored here (`docs/decisions.md`: route data is held in memory for the lifetime of a
track and never written to disk).

- `✓ airport + direction` — the database has Newark as the matching endpoint: the
  origin for something we called a departure, the destination for an arrival. Seven
  rows. Strong independent agreement.
- `~ airport only` — Newark is an endpoint, but on the other side. The database is
  showing the other leg of that number. Says the aircraft really does work Newark;
  says nothing about direction.
- `? no match` — the entry for that number does not touch Newark at all. Because the
  database is date-less this is **not** evidence against us; those rows are exactly
  the ones worth a tracker.
- `type` — settled from the aircraft type code alone (see below).

**2. The aircraft type code**, which is what the caption is built from, was checked
against the caption. This found a real defect — row 9 — described under the table.

**3. Arithmetic, where two rows are the same aircraft.** Rows 11 and 13 are one
flight: 1 575 ft at 16:00:21, then 6 450 ft at 16:02:28. That is 4 875 ft in 127 s =
2 303 ft/min average, between the 1 088 and 2 944 ft/min the two rows report. The
climb is internally consistent; it is one real departure seen twice, not two events
invented.

## The table

`—` in the callsign column means the aircraft was private and its identity was
discarded before recording (§3.2), not that we failed to read it.

| #   | Local (EDT) | UTC      | Detected as       | Callsign | Type | Position          | Alt (ft) | V/S (ft/min) | Our caption                           | Independent           | ✅/❌ | Notes                                                 |
| --- | ----------- | -------- | ----------------- | -------- | ---- | ----------------- | -------- | ------------ | ------------------------------------- | --------------------- | ----- | ----------------------------------------------------- |
| 1   | 15:41:52    | 19:41:52 | `helicopter`      | —        | S76  | 40.7516, -74.1481 | 900      | +128         | 🚁 a helicopter crossing Newark       | ✓ type                |       |                                                       |
| 2   | 15:41:52    | 19:41:52 | `overflight_city` | —        | S76  | 40.7516, -74.1481 | 900      | +128         | ✈ a helicopter over the city          | ✓ type                |       |                                                       |
| 3   | 15:47:29    | 19:47:29 | `ewr_arrival`     | ASA295   | —    | 40.7344, -74.1381 | 900      | −832         | ✈ an airliner arriving at Newark      | ? no match            | ✅    | FlightAware: SEA→EWR, landed 15:49 EDT. See below.    |
| 4   | 15:48:13    | 19:48:13 | `ewr_departure`   | UAL1021  | —    | 40.6382, -74.2025 | 1850     | +640         | ✈ an airliner departing Newark        | ✓ airport+direction   |       |                                                       |
| 5   | 15:52:16    | 19:52:16 | `ewr_arrival`     | UAL1499  | —    | 40.7373, -74.1361 | 950      | −832         | ✈ an airliner arriving at Newark      | ~ airport only        |       |                                                       |
| 6   | 15:52:38    | 19:52:38 | `ewr_departure`   | UAL1498  | —    | 40.6509, -74.1917 | 1525     | +1024        | ✈ an airliner departing Newark        | ✓ airport+direction   |       |                                                       |
| 7   | 15:53:27    | 19:53:27 | `helicopter`      | —        | S76  | 40.7039, -74.1681 | 125      | +256         | 🚁 a helicopter crossing Newark       | ✓ type                |       |                                                       |
| 8   | 15:55:01    | 19:55:01 | `overflight_city` | —        | S76  | 40.7217, -74.1756 | 625      | −64          | ✈ a helicopter over the city          | ✓ type                |       |                                                       |
| 9   | 15:55:40    | 19:55:40 | `overflight_city` | —        | B407 | 40.7567, -74.1594 | 800      | −64          | ✈ a plane over the city               | **❌ defect — fixed** | ❌    | caption wrong: a Bell 407 is a helicopter. See below. |
| 10  | 15:56:08    | 19:56:08 | `ewr_departure`   | RPA5829  | —    | 40.6630, -74.1841 | 1500     | +1280        | ✈ an airliner departing Newark        | ? no match            | ✅    | FlightAware: EWR→BOS, held on the ground. See below.  |
| 11  | 16:00:21    | 20:00:21 | `ewr_departure`   | UAL124   | —    | 40.6464, -74.1977 | 1575     | +1088        | ✈ a heavy jet departing Newark        | ✓ airport+direction   |       |                                                       |
| 12  | 16:01:54    | 20:01:54 | `ewr_arrival`     | GJS4560  | —    | 40.7383, -74.1356 | 1000     | −576         | ✈ a small jet arriving at Newark      | ✓ airport+direction   |       |                                                       |
| 13  | 16:02:28    | 20:02:28 | `overflight_city` | UAL124   | —    | 40.7250, -74.1917 | 6450     | +2944        | ✈ a heavy jet over the city           | ✓ + arithmetic        |       |                                                       |
| 14  | 16:08:24    | 20:08:24 | `ewr_arrival`     | UAL316   | —    | 40.7266, -74.1431 | 725      | −512         | ✈ a large airliner arriving at Newark | ✓ airport+direction   |       |                                                       |
| 15  | 16:09:20    | 20:09:20 | `ewr_arrival`     | UAL2392  | —    | 40.7324, -74.1395 | 825      | −704         | ✈ an airliner arriving at Newark      | ? no match            | ✅    | FlightAware: BDA→EWR, landed 16:10 EDT.               |
| 16  | 16:09:56    | 20:09:56 | `ewr_departure`   | RPA3584  | —    | 40.6653, -74.1848 | 1550     | +1152        | ✈ an airliner departing Newark        | ~ airport only        |       |                                                       |
| 17  | 16:10:40    | 20:10:40 | `overflight_high` | —        | LJ45 | 40.7441, -74.2111 | 41000    | 0            | ✈ a private jet high above Newark     | ✓ type                |       |                                                       |
| 18  | 16:13:59    | 20:13:59 | `ewr_arrival`     | GJS4508  | —    | 40.7344, -74.1382 | 900      | −537         | ✈ a small jet arriving at Newark      | ✓ airport+direction   |       |                                                       |
| 19  | 16:14:23    | 20:14:23 | `overflight_city` | JZA497   | —    | 40.7284, -74.2092 | 6100     | +1924        | ✈ an airliner over the city           | ? no match            | ✅    | FlightAware: EWR→YUL, took off 16:11 EDT.             |
| 20  | 16:19:30    | 20:19:30 | `ewr_departure`   | JBU685   | —    | 40.6470, -74.1910 | 1800     | +1024        | ✈ an airliner departing Newark        | ? no match            | ✅    | FlightAware: EWR→FLL, off gate 15:57 EDT.             |

### The five rows that most need a tracker

3, 10, 15, 19, 20 — the `? no match` rows. Direct links:

- row 3 · [flightaware.com/live/flight/ASA295](https://www.flightaware.com/live/flight/ASA295) · [fr24 AS295](https://www.flightradar24.com/data/flights/as295) — 19:47Z, descending into Newark
- row 10 · [flightaware.com/live/flight/RPA5829](https://www.flightaware.com/live/flight/RPA5829) — 19:56Z, climbing out of Newark
- row 15 · [flightaware.com/live/flight/UAL2392](https://www.flightaware.com/live/flight/UAL2392) · [fr24 UA2392](https://www.flightradar24.com/data/flights/ua2392) — 20:09Z, descending into Newark
- row 19 · [flightaware.com/live/flight/JZA497](https://www.flightaware.com/live/flight/JZA497) — 20:14Z, 6 100 ft climbing over the city
- row 20 · [flightaware.com/live/flight/JBU685](https://www.flightaware.com/live/flight/JBU685) · [fr24 B6685](https://www.flightradar24.com/data/flights/b6685) — 20:19Z, climbing out of Newark

And one playback window covers four of the unnamed rows at once: **19:41Z–19:55Z,
centred on 40.73, −74.16** gets rows 1, 2, 7 and 8. Row 17 is at 20:10Z,
40.7441 −74.2111, at 41 000 ft — in playback, set the altitude filter high or it will
be buried under the low traffic.

## Checked against a tracker: row 3

Mohammad opened FlightAware for ASA295 on 14 Oct 2026. It landed at Newark at
**15:49 EDT**, from Seattle. We saw it at **15:47:29** at 900 ft descending at
832 ft/min: 900 ÷ 832 ≈ **65 seconds from the ground**, which puts touchdown at about
15:48:34 against a reported 15:49. Under half a minute out, and out in the right
direction — the descent rate slows in the flare, so the real touchdown should be a
little later than a constant-rate estimate. **✅**

It also settles something the schedule database could not. That database's entry for
ASA295 is **LAX→SEA**: not this flight, not even the right coast. The real flight was
SEA→EWR. This is the clearest demonstration of why §3.2's rule is conservative in the
right direction — Newark appears nowhere in the database's route, so the rule forbids
naming it and the caption stays type-based ("an airliner arriving at Newark") rather
than confidently announcing a flight to Seattle. A wrong route was available and the
rule refused it.

## Checked against a tracker: row 10, and why gate times are not our times

FlightAware has RPA5829 leaving **gate A4 at 14:51 EDT** for Boston — an hour before
we saw it. That gap is not a disagreement: 14:51 is the **gate** time, and the same
page carries a delay notice for Boston Logan, so the aircraft pushed back early and
then waited on the ground.

Our figures close it. At 15:56:08 it was at 1 500 ft climbing 1 280 ft/min, so it
left the runway about **70 seconds earlier, around 15:55**. It reached its Boston gate
at 16:53 — 58 minutes later, against a typical EWR–BOS airborne time of 45–50 minutes
plus taxi. The numbers meet. **✅**

Worth stating plainly because it will come up again whenever a schedule is used as
evidence: **a gate time is not a wheels-off time**, and the two differed by an hour
here. We read ADS-B, so our timestamp is the physical event; a schedule describes the
door. Where a tracker page offers both, the one to compare against is its own
_Takeoff_ / _Landing_ field, not the gate row.

## Checked against a tracker: rows 15 and 19, and what they say about route data

**Row 15.** UAL2392 came from Bermuda and FlightAware's own _Landing_ field gives
**16:10 EDT**. We saw it at 16:09:20 at 825 ft descending 704 ft/min — 70 seconds from
the ground, so touchdown at about 16:10:30. **✅**

**Row 19.** JZA497 left Newark for Montreal, _Takeoff_ **16:11 EDT**. We saw it at
16:14:23 at 6 100 ft: 203 seconds after lift-off, an average climb of 1 803 ft/min
against the 1 924 ft/min we read at that instant. **✅**

### The schedule database was wrong five times out of five

Every row where that date-less database failed to put Newark in the route has now been
checked, and in all five the database was simply describing a different flight:

| Callsign | The database | What actually flew |
| -------- | ------------ | ------------------ |
| ASA295   | LAX→SEA      | **SEA→EWR**        |
| RPA5829  | JFK→DCA      | **EWR→BOS**        |
| UAL2392  | PHX→SFO      | **BDA→EWR**        |
| JZA497   | YSJ→YYZ      | **EWR→YUL**        |
| JBU685   | JFK→RDU      | **EWR→FLL**        |

Five for five, and two more rows (5 and 16) have Newark on the wrong side, which is
the same failure in a milder form. Of the thirteen callsigns looked up, seven are
demonstrably describing some other leg or some other day.

The seven rows where it _did_ agree with us are not thereby worthless. The failure we
observed is "describes a different flight", which produces **disagreement**; for a
wrong entry to agree with both the airport and the direction we independently measured
would take a coincidence. Agreement is still evidence. But it is weaker evidence than
this column implied when it was written, and rows 5 and 16 — Newark on the wrong side
— are now better read as two more of the same failure than as anything about our
detection.

This matters for Phase 1, where §3.2 promises the route for airline flights. A
callsign-keyed route lookup with no date is not a source of truth — and the only thing
that stopped us announcing "an airliner to Seattle" over an aircraft on final approach
from Seattle is §3.2's requirement that an endpoint match the airport we observed. It
suppressed all five. Two conclusions, both for Mohammad:

- **Keep the endpoint-match rule, and tighten it** as already logged: the matching
  endpoint must be on the correct side (destination for an arrival, origin for a
  departure). On this sample that rule is doing nearly all the work.
- **A route we cannot verify should not be spoken.** If Phase 1 wants routes, it needs
  a dated source; otherwise the honest caption is the type-based one we already have,
  which was correct in all twenty rows. §1.2 — every sound is true — is better served
  by saying less.

## The defect this table found: row 9

The aircraft was a **Bell 407** — a helicopter — and it was captioned
"✈ a plane over the city". Two separate faults behind one wrong caption:

1. It broadcast emitter category **D0**. D0 is the "reserved" code: not a category at
   all. The caption vocabulary had no entry for it and no entry for the type code
   `B407`, so it fell all the way through to the floor, `a plane`.
2. `detection.helicopter` matched on emitter category alone, so this helicopter
   produced no `helicopter` event, no 🚁 glyph, and none of §6.4's helicopter voice.

Replaying the day's recorded observations shows the same airframe reporting category
**A0, A7 and D0** at different times — which is the whole lesson. Emitter category is
configured by hand in the transponder and is often absent or wrong; the type code is
not. The fix makes either signal sufficient, with both lists in
`config/sources.yaml`:

- `detection.helicopter.type_codes` — 21 rotorcraft types, checked as an OR with
  `emitter_category`.
- `aircraft_vocabulary.by_type` — the matching captions, so a detected helicopter is
  never described as a plane. A test asserts every code in the first list has a
  helicopter caption in the second, so the two cannot drift apart.

Replayed over the same window, `helicopter` events go from **5 to 8** while
`overflight_city` (19) and `overflight_high` (2) stay identical — the control that
says only the intended rule changed. No event in the whole recording now falls back
to the generic "a plane".

The live container is deliberately **not** restarted for this: it is 2 hours into the
48-hour recording the gate needs, and §9.1's rate-limit manners cost us an HTTP 429
earlier today from restarting too often. The fix is in the code and in the tests, and
reaches the live detector at the next natural restart.

## Result

- ✅ \_\_\_ · ❌ \_\_\_ · could not tell \_\_\_
- Precision: \_\_\_ %
- **Go / no-go for Phase 1:** \_\_\_

### What to write down if something is wrong

Which rule misfired, and what the aircraft was actually doing. The thresholds all live
in `config/sources.yaml` and §3.2 says plainly they are starting values — so a ❌ is
a tuning input, not a failure, unless it points at a rule that is wrong in principle.
