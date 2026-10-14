# Decisions log

What was decided, why, and when (SPEC §0). Newest last. Music decisions live in
`docs/music/decisions.md`.

## 2026-10-14 · Repo, agents, and Phase 0 planning

- **Repo `brick-city-hum`, public, under `mdindoost`.** Mohammad's call. Non-commercial
  and attribution-driven, so openness fits; `.env` gitignored from the first commit
  and `.env.example` carries key names only. Every commit assumes a stranger reads it.
- **SPEC.md is treated as living, not frozen.** Mohammad's instruction: it records what
  he knew when he wrote it, and improving it is part of the work. Procedure: propose →
  he confirms or denies → SPEC.md is updated and the decision logged here. Neither
  silent redesign nor silent compliance with a line we believe is wrong.
- **Four subagents created** (`.claude/agents/`): `music-director` (opus, SPEC §7.4
  verbatim plus a tools limit), `implementer` (sonnet), `api-scout` (haiku, read-only —
  no Write or Edit tool, so it cannot write code even by accident), `reviewer` (opus,
  no Write or Edit — it reports, the author fixes). The tool limits are the point: each
  agent is structurally unable to do the job it should not be doing.
- **Agent files do not register until the session restarts**, so the first [VERIFY]
  sweep ran as three `general-purpose` agents pinned to haiku with the `api-scout`
  brief inlined. Same behaviour and cost; the files are correct for next session.
- **Recorder ships before everything else in Phase 0.** §13 needs ≥ 2 days of real
  data, which is 48 h of wall clock that no amount of work compresses. Everything else
  is built while it records. See `docs/plan-phase0.md`.
- **Record raw API responses alongside normalized events** _(proposed, awaiting
  confirmation)_. §3.2's thresholds are explicitly starting values to be tuned; if we
  keep only normalized output, re-tuning means another 48 h wait.
- **ffmpeg was missing** from the machine; needed for the lab's LUFS and spectrograms
  (§7.3). Mohammad authorized installing it.

## 2026-10-14 · Phase 0 renders through a probe voice (SPEC §13 amended)

**Problem.** §13 required the listening lab in Phase 0 and its gate was "the lab
renders a 10-minute WAV", but §7.3 defines rendering as replaying _through the client
audio engine_ — which §13 schedules for Phase 1. Phase 0 could not complete as
written: circular dependency, a spec bug rather than a misreading.

**Decision (Mohammad, option 2 of three).** Phase 0 builds a deliberately crude
**probe voice** so the measurement chain is proven before Phase 1's real voices land
in it. Rejected: moving the lab to Phase 1 (Phase 1 would then debug engine and
renderer against each other) and rendering a synthetic test signal (proves ffmpeg
works and nothing else). SPEC §13 Phase 0 updated accordingly.

**Three refinements, all from Mohammad, all binding:**

1. **The probe plugs into the real interface, not a side door.** Define the
   event→voice interface Phase 1 voices will implement, and make the probe its first
   implementation. Route its output through the planned master chain (compressor +
   −1 dBTP limiter). _Rationale: a harness that bypasses the real path lets Phase 1
   discover interface bugs late, which is the exact cost we were buying our way out of._

2. **Determinism traps are real and must be handled explicitly.** `Tone.Reverb`
   builds its impulse response from noise generated with `Math.random`, so renders
   will **not** be bit-identical even from a fixed seed. Either keep `Tone.Reverb`
   out of the probe, or substitute the seeded PRNG for `Math.random` during offline
   renders. The same applies to any other `Math.random` or `Date.now` inside the
   engine — including `Tone.Noise`-based textures, which §6.2's rain and wind
   textures will use. The substitution must be installed **before** the engine
   constructs any audio node, or the IR is already generated from unseeded noise.
   **Acceptance: render the same slice twice → identical SHA-256.** Documented
   fallback: max sample difference below −90 dBFS, with the reason logged here.
   _Rationale: without this, every later A/B comparison is confounded by renderer
   noise and we cannot tell a musical change from a rendering artifact._

3. **Demote the probe, do not delete it.** It moves to
   `lab/fixtures/probe-voice.ts`, is excluded from the production client bundle, and
   is retained as the renderer's regression fixture — a CI-style check that the
   harness still produces the known hash. _Rationale: when something sounds wrong
   months from now, one run distinguishes "the renderer changed" from "the music
   changed". This supersedes the earlier plan to delete the probe after Phase 1._

## 2026-10-14 · Contact address: personal email, kept out of the repo

**Decision (Mohammad).** The §9.1 `User-Agent` contact is his personal address, held
in `.env` (gitignored) and read at runtime via `process.env.CONTACT_EMAIL`. It is
**not** shown on the public `/attributions` page — §12 requires crediting the data
_sources_, and none of them obliges us to publish our own address.

**What this does and does not hide**, stated plainly so nobody later assumes more:

- Hidden from the public repo and from GitHub scrapers — **yes, completely.**
- Hidden from the API providers — **no, by design.** adsb.lol and adsb.fi see it in
  their logs, which is the entire point: a maintainer who notices odd traffic emails
  us instead of silently blocking the IP. These are volunteer projects, not a spam risk.
- Hidden from site visitors — yes, since it never reaches the page.

**Guard: `.githooks/pre-commit`.** Git history is permanent; one accidental commit
would need a history rewrite to undo. The hook blocks any email-shaped string in
staged _added_ lines, and separately blocks the literal `CONTACT_EMAIL` value read
from `.env`. **The hook itself contains no address** — it reads the one to protect
from `.env` and otherwise matches generically, so the guard cannot leak what it
guards. Deliberate exceptions go in `.githooks/allowed-emails` (currently only
`noreply@anthropic.com`, which appears in commit trailers).

Tested all three paths before committing: the real address blocked, an unrelated
address blocked, an allowlisted address passed.

**Fresh clones must run `git config core.hooksPath .githooks`** — git does not carry
hook configuration in a clone. This will be wired into the P0-1 scaffold's setup
script so it is not a thing anyone has to remember.

## 2026-10-14 · Aircraft source strategy after verifying every alternative

**Context.** Verifying SPEC §3.1's fallback chain turned up a market-wide problem
rather than a per-source one. Full evidence in `docs/verification.md`.

| Source              | Status                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- |
| adsb.lol (A1)       | works, keyless today; README says a key _will_ be required, earned by feeding       |
| adsb.fi (A2)        | works; envelope key is `aircraft` not `ac`                                          |
| OpenSky (A3)        | **written licence required** for operational use, regardless of non-profit status   |
| airplanes.live      | **HTTP 403**, gated on an emailed project description                               |
| Flightradar24       | economically impossible: ~258,000 req/month needed vs 30,000 credits on its $9 tier |
| ADS-B Exchange      | commercial-licence wording explicitly covers non-profits                            |
| FlightAware AeroAPI | per-query pricing; free tier limited to "personal or academic"                      |

**Decisions (Mohammad):**

- **(a) OpenSky: build the collector, ship it disabled.** The code is written in Phase
  1 behind a config flag, default **off**, and stays off until a written licence
  arrives. Writing code is not use. Requesting permission by email from an `@njit.edu`
  address, since their own FAQ asks institutional applicants to do exactly that.
  _Rejected alternatives: dropping A3 entirely (loses a ready fallback for a request
  that costs one email) and enabling it now (§1.7 makes zero licensing exposure a
  principle, not a preference)._
- **(b) Request access from airplanes.live too.** Its 403 message invites exactly this,
  and its own guide header says "Non-Commercial Use", so the fit is plausible. Two
  emails, sent together. Drafts in `docs/outreach.md`.
- **Until either replies, the chain is A1 → A2 → simulator.** §3.5 already designates
  the simulator as the labelled last resort, and its events carry `sim: true` with
  "replay" captions, so a listener is never misled about what they are hearing.
  Phase 0 and Phase 1 need nothing more than this.
- **Flightradar24 ruled out on arithmetic, not licence.** Its terms could not be read
  (every page 403s), so the licence question stays open — but at 10 s polling we need
  ~258,000 requests/month against 30,000 credits on its cheapest tier, and reducing
  the poll rate to fit would break §6.4's moving `overflight_city` voice and the
  altitude-crossing departure detection. A subscription-dependent source is also a
  structural mismatch for a project §13 Phase 4 says is never finished.

**SPEC amended:** §3.1 row A3 now records the licence gate and the disabled-by-default
flag, a new row A3b tracks the airplanes.live request, and §14 gains a row for the
market-wide risk with our own receiver named as the licence-free endgame.

**Still open: (c) our own RTL-SDR receiver.** Mohammad asked for precise costing
before deciding. Not a Phase 0 or Phase 1 item either way.

## 2026-10-14 · Own receiver recorded as a Phase 3 option, costing deferred

**Decision (Mohammad):** record it in the spec, re-price it when we reach Phase 3.

Precise costing was attempted and **failed honestly**: only one US price could be
confirmed (FlightAware Pro Stick Plus, $45.99, and even its stock is ambiguous). The
FlightAware 26" antenna reads as discontinued at several retailers, the RTL-SDR Blog
V4 kit is out of stock or retired everywhere checked, and what remains is
foreign-currency or second-hand. Amazon is not readable by our tooling. Re-researching
now would produce numbers that are stale before the decision is made.

Useful facts that **will not** go stale, and are now in SPEC §3.6: no Raspberry Pi is
needed (the §11.1 laptop suffices, saving ~$60–80); `readsb` + `tar1090` are free and
GPL-3.0; a dongle with a built-in 1090 filter removes a separate purchase, and
FlightAware recommend filtering in exactly our kind of RF environment; and the radio
horizon means a 25 nm radius reaches aircraft above ~413 ft, so **buildings are the
constraint, not altitude**.

**Correction worth recording.** The costing agent reported that our claim about
adsb.lol announcing a future API key was unverified. It was looking at the wrong
repository — `adsblol/feed` rather than `adsblol/api`, where an earlier agent had
quoted the README verbatim: _"In the future, you will require an API key which you can
obtain by feeding adsb.lol."_ The original claim stands, and §14 is unchanged. Noted
because it is a reminder that a subagent's confident negative needs the same scrutiny
as its positive.

## 2026-10-14 · Route caching, raw recording, and a permanent reference library

Three connected decisions, all prompted by Mohammad pushing on _why_ we store anything.

**1. Route cache: in memory, scoped to the aircraft's track lifetime.** His point was
that once a plane has gone its route is useless to us — correct, and it improves on
§3.1's original "cache per callsign per day". The cache's purpose is not retention but
politeness: without one we cannot tell a first sighting from the sixtieth, so we would
send roughly **985,000 requests/day** to adsbdb (8,640 polls × ~114 aircraft) instead
of about **1,500**. A 650× difference, and the difference between being a guest and
being blocked. Scoping it to the track lifetime keeps the musical benefit (captions
can say "United to Chicago" rather than just "a United flight", which §1.2 cares
about), costs nothing, and incidentally makes adsbdb's route-data restriction moot —
we never copy, publish, or incorporate anything into a database.

**On the MIT question** (his reading was that MIT settles it): the reading is
reasonable and the practical conclusion is the same, but the structure is worth
recording. MIT covers the repository's _code_. The route data is separately credited
to two named individuals with their own restriction, and a maintainer cannot MIT-license
someone else's contribution — which is why both statements sit on one page looking
contradictory. For our actual use (an ephemeral lookup, a caption, then forgotten) none
of the three forbidden acts occurs. The GitHub issue is downgraded to optional.

**2. Record raw API responses too, gzipped.** ~40–60 MB/day. §3.2's thresholds are
explicitly starting values; keeping only normalized output would mean re-recording two
full days every time we re-tune.

**3. Rolling recordings vs. a permanent reference library.** Mohammad asked whether
recordings are needed forever once the music is good. Mostly no — §11.3's 30-day cap
already handles the bulk. But not entirely, and the strongest counter-argument is his
own spec: §1.5 says beauty is never done and §13 Phase 4 is never closed, so A/B
testing never ends, and **§7.3's A/B method requires identical input** — palette A at
2 p.m. against palette B at 4 p.m. compares two different cities, not two palettes.
Recordings are also what the simulator replays as a permanent fallback (§3.5), what
makes a regression diagnosable ("did the music change or the city?"), and what lets a
winter palette be tuned without waiting for winter.

Resolution: a curated **reference library** of 8–10 deliberately chosen 30-minute
slices — busy weekday morning, dead 3 a.m., thunderstorm, snow, holiday, summer
evening, reversed EWR runway flow — kept permanently and exempt from the 30-day cap.
At ~1 MB gzipped per slice that is **~10 MB forever**. Each slice records why it was
kept, so a future session does not delete something that looked redundant.

**SPEC amended:** §3.1 row A4 (cache scope + the 985,000 figure), §3.5 (raw recording,
and the rolling/reference split with its reasoning), §11.3 (reference library exempt
from the cap), and a new **§3.7** collecting the normalizer-boundary rules — privacy
stripping and route-cache scope — in one place, since both are easy to violate later.

## 2026-10-14 · P0-2 reviewed: what changed and what was deferred

The reviewer re-derived every geo fixture independently (law of cosines, Vincenty
sphere, and a hand-written WGS-84 Vincenty inverse) and confirmed the arithmetic,
the bearing convention, and the unit constants. Ten findings, all addressed:

**Fixed now:**

- **Boot validation caught no mistake that mattered.** A transposed Newark lat/lon,
  a dropped minus sign, or a one-digit slip all stayed inside ±90/±180 and loaded
  happily — the server would start, report healthy, and compute every bearing from a
  point in the Southern Ocean. Added a **Newark-area plausibility box**; it is the
  only check that catches a human mistake here. Also replaced `z.record` with a
  fixed-shape object so the §3.2 reference points are required **by name** (renaming
  `ewr:` to `eww:` previously loaded fine and failed later inside the detector), which
  also removed every `!` assertion from the call sites.
- **A test that passed by luck.** The FAA runway-length check used a 5 m tolerance and
  only tested 04L/22R. The spherical model's error _flips sign with orientation_ — at
  40.7° the prime-vertical (6387 km) and meridional (6362 km) radii bracket the mean
  radius we use — so the north-easterly parallels read ~2 m long while the east-west
  crosswind pair reads ~5 m **short** and would have failed the same assertion. Now
  all three strips are tested against a **derived** 8 m tolerance, with the reason in
  the test.
- **Two fixtures claimed external facts they did not check.** "One degree of latitude
  at the equator = 111.19508 km" is exactly `EARTH_RADIUS_KM × π/180`; the real
  WGS-84 figure is 110.574 km. Kept (they do catch a wrong formula) but relabelled
  honestly so nobody later treats them as validating the Earth model.
- **Runway headings were validated against nothing.** The reciprocal test accepts any
  pair 180° apart, so `04L: 62 / 22R: 242` would have passed. Now each published
  heading is checked against its own thresholds.
- YAML syntax errors were reported as "could not read file" with the parser's line
  and column buried in `.cause`; read and parse are now separate.
- `CONFIG_DIR` was captured at module load and resolved against `process.cwd()`,
  which would have broken under P0-4's Docker `WORKDIR`. Now resolved relative to the
  repo and passable as an argument, which is also what made the negative tests possible.
- Added nine negative config tests. The error path — including `z.prettifyError`, a
  zod-4-era API — was previously never executed, so a dependency bump could have
  turned the project's one boot diagnostic into a `TypeError` with the suite green.
- Added a knots conversion. adsb.lol reports ground speed in knots and OpenSky in
  m/s: the same silent-mistuning hazard `units.ts` exists to prevent, one field over.
  Canonical ground speed is knots.
- Fixed a comment that stated the forward/reverse bearing difference as 179.9933°
  when it is 180.00665° — in a comment whose only job was to teach that fact.
- Pinned `bearingDeg(p, p) === 0` and documented the non-finite precondition.

**Deferred, deliberately:**

- **NaN propagation.** `distanceKm`/`bearingDeg` return NaN for non-finite input, and
  `JSON.stringify(NaN)` is `null`, so a bad coordinate could reach the wire as
  `rel: {bearing_deg: null}`. CLAUDE.md puts validation at the boundary, so this is
  **P0-3's** job; the precondition is now documented in `geo.ts`.
- **A Phase 1 audio constraint worth recording before anyone writes the pan code.**
  §3.2's `overflight_city` circle is 3 km, so an aircraft passing nearly over NJIT
  swings through ~180° of bearing between two 10-second polls — e.g. 2° then 182°.
  §6.4 wants the pan to follow the aircraft, but applied naively that is an audible
  snap across the stereo field at the moment the listener is most likely to be paying
  attention. The voice layer needs a slew-rate limit or a distance-weighted pan width.
- `ewr_runways` is structurally readable by a future detector even though §3.2 forbids
  using it as a detection input. Today nothing reads it but the sanity tests, and the
  prohibition is loud in `places.yaml`. Revisit if P0-5 is tempted.

## 2026-10-14 · P0-3 built: collector, recorder, and what live data corrected

**Verified against the live feed, not just tests.** The server ran against adsb.lol,
tracked 100–105 aircraft, wrote both recordings, and flushed cleanly on SIGTERM.
Three things only the smoke test could have found:

1. **`.env` was never being read.** Node does not load it automatically, so the
   server ran with `contact: unconfigured` even though the address was sitting in the
   file — every outbound request would have been unattributable, which is the exact
   failure SPEC §9.1 exists to prevent. Now loaded via `process.loadEnvFile` when the
   file exists (absent under Docker, where the environment is supplied directly).
2. **The missing-contact warning printed twice**, because `userAgent()` recomputed it
   per call. Cached.
3. **A standby source was reported as `down`.** adsb.fi had never been polled, yet
   `/healthz` called it down — which would page a human about a healthy system.
   **Proposed §3.5 addition: an `idle` state** for a source that has not been tried.
   SPEC §3.5 lists only `ok`/`degraded`/`down`; this is a fourth. _Flagged for
   confirmation rather than assumed._

**Measured sizes replace estimates.** ~27 MB/day of observations plus ~64 MB/day raw
= **~91 MB/day**, so ~2.7 GB for the 30-day window. My earlier 40–60 MB/day estimate
was low; SPEC §3.5 and §11.3 corrected.

**The privacy rule, confirmed on real traffic.** Of 100 aircraft over Newark, **26
carried non-airline callsigns shaped exactly like tail numbers** — `N56578`, `N6091F`,
`N814TW`, `N955AA`. Passing `flight` through verbatim would have published a quarter
of the traffic's tail numbers into append-only recordings, _without ever touching the
`r` field_. The classifier is a heuristic and fails safe toward `private`, so a miss
costs a duller caption, never a breach. Grepping both real recording files found zero
`"r"`, zero `ownOp`, and zero tail-number-shaped strings.

**The resolution of the §3.5-vs-§3.7 conflict** (recording "every raw response" vs.
stripping identity before the append-only files): **"raw" means every field except
identity.** Tuning §3.2's thresholds needs altitude, rates, category and position —
none of which is identifying — so nothing of value is lost.

**Design note: one source polled at a time.** Each source keeps its own interval,
backoff and health, because adsb.fi's documented 1 req/s is not adsb.lol's "dynamic"
and conflating them would respect neither. Polling both continuously would double the
load on two volunteer services to gain nothing, since they carry the same traffic.
Failover advances on `down` and drifts back to the preferred source when it recovers.

**`setInterval` was deliberately avoided** for polling: it allows a slow response to
overlap the next request and silently double our request rate against services that
return no rate-limit headers to notice it with. The loop schedules the next attempt
only after the current one settles, and there is a test asserting concurrency never
exceeds 1.

## 2026-10-14 · P0-3 review: a privacy leak I had reported as verified

**The leak.** `IDENTIFYING_FIELDS` stripped `r` (registration) but not `flight`. The
commit's own premise was that _for a private aircraft the callsign IS the
registration_ — so the code removed the tail number from one field and wrote the
identical string from another, straight into the append-only recordings. Exactly the
failure §3.7 exists to prevent, and a direct miss of P0-3's acceptance criterion.

**Why my verification missed it, which is the more useful lesson.** I grepped for
`"(N\d{2,5}[A-Z]{0,2})"` — anchored on a closing quote. The API space-pads the value
(`"N6091F  "`), so nothing matched. I knew about the padding; I `trim()` it in the
parser and documented it in a comment. Then I wrote a check the padding defeated and
told Mohammad the rule was "verified on real data". It was not.

Re-verifying after the fix, I made the **opposite** error: an unanchored
`N\d{2,5}[A-Z]{0,2}` flagged six hits, all the substring `N8979` inside `MTN8979` —
Mountain Air Cargo's ICAO callsign, not a registration. The correct pattern is
word-anchored: `\bN\d{1,5}[A-Z]{0,2}\b`.

**The tests have been rewritten to check values, not keys**, because a key-based
assertion is what waved the original bug through, and a new test asserts the fixture
_contains_ identity — otherwise the headline privacy test passes vacuously, which it
had been doing since the fixture was captured with `r` already stripped.

**Verified after the fix, on 383 live observations:** 99 private aircraft, **zero**
with a callsign, 96 keeping a type code (`GLF5` — a Gulfstream, precisely §3.2's "a
small private jet"); zero non-airline `flight` values in the raw file; zero
word-anchored registration matches anywhere.

**Other confirmed findings, all fixed:**

- **Schema drift read as an empty sky.** If every aircraft failed to parse, the poll
  recorded `ok` with zero observations, `/healthz` stayed green, backoff and failover
  never engaged — total silent data loss across the 48-hour window with a green
  monitor. Now: aircraft returned but none parsed is an error. Unparseable entries
  are also kept in the raw file, so drift is diagnosable afterwards.
- **Failover was one-way.** A stopped poller never polls, so the primary's health
  froze at `down` and the "drift back on recovery" branch was unreachable code. One
  30-second blip at hour 3 would have pinned the remaining 45 hours of the Phase 0
  dataset to the fallback, silently changing the poll cadence mid-dataset. Now the
  supervisor probes the preferred source while on a fallback. `AircraftCollector` had
  **no tests at all**; it now has seven, including one that fails if recovery regresses.
- **Every failover injected an un-backed-off request**, because `start()` fired
  immediately — wrong precisely when the cause was a 429. `start()` now honours
  accumulated backoff.
- **A stop/start during a request ran two loops**, doubling our request rate. First
  attempt at a fix (a generation counter) addressed the wrong half; the working fix
  is an in-flight guard, with `start()` standing down so the outstanding request's
  own continuation carries the loop.
- **"A crash costs one line" was false as written.** On a truncated file
  `gunzipSync` throws `Z_BUF_ERROR` and returns _nothing_ — a whole-day loss — and
  `gunzipSync` is what the test helper used. Added `readRecording`, a streaming
  tolerant reader, as the supported read path for the simulator and lab, with a test
  that truncates a real file and one documenting that `gunzipSync` would have lost it.
- **No write-error handling**: ENOSPC on a 2.7 GB budget emitted an uncaught
  exception that `index.ts` swallowed, leaving health `ok` while nothing was written.
  Now reported through `/healthz`. Also closes the previous day's stream at rollover
  (was leaking two fds per UTC day).
- **`ok` never aged out**: a stalled poll loop would keep `/healthz` at 200 with an
  hours-old success. Now bounded at 120 s — a monitor can finally tell a stalled
  recorder from a quiet city, which §3.5 says is the whole point of health.
- **Timestamps were the receive time for every aircraft.** Live `seen_pos` runs to
  ~50 s on parked aircraft, so a stale repeat looked like a fresh observation at a new
  time — defeating the track store's duplicate guard. `t` is now backdated by the
  reported position age (clamped, never future), `positionAgeS` is kept for tuning,
  and the envelope's own clock is recorded so our latency is distinguishable from the
  feed's.
- **Empty polls wrote nothing**, so the recordings could not distinguish "empty sky at
  4 a.m." from "we were not polling". A one-line-per-poll heartbeat file now does.
- **Four real registrations were committed to a public repo** (fixture and decisions
  log). Replaced with synthetic N-numbers of identical shape, which exercise the
  classifier identically. CLAUDE.md's "assume a stranger will read it" applies to
  data as much as to code.
- **Duplicated tuning values**: `A7`/`A5` were declared in both `observation.ts` and
  `sources.yaml`, so editing the YAML changed nothing. The code copies are gone;
  config is the single source. `Observation` is now derived from its zod schema rather
  than hand-mirrored, so the two cannot drift — which also finally satisfies P0-3's
  "ndjson lines validate against the schema".
- Removed `lastExpiryCheck()`, which returned the current time rather than the last
  expiry check and was the only consumer of an injected clock.

**Still open, needs Mohammad: the classifier equates "ICAO-shaped callsign" with
"airline".** Fractional and charter operators pass as airlines — the fixture's own
`LXJ312` is Flexjet, and NetJets' `EJA…` would too. §3.2's letter holds (these are
not tail numbers), but these are arguably the private jets its spirit is aimed at.
See the question raised with him on 2026-10-14.

## 2026-10-14 · Captions never contain a raw callsign (SPEC §3.2 amended)

**The question Mohammad asked:** fractional-jet operators file ICAO-pattern callsigns,
so the classifier called them airlines. Should Flexjet and NetJets be reclassified as
private? He asked for an outside opinion, then for me to verify it and decide.

**The reframe, which came from the consultation and which I had missed:** for an
airline we never show the callsign either — we show "United to Chicago". `LXJ489` only
reaches a screen because the operator lookup failed and the fallback was "print the
raw string". So the defect is not misclassification; it is **an unresolved identifier
leaking verbatim.** Fix the fallback and the classification question largely dissolves.

**Where I did not follow the advice.** It proposed gating on "scheduled commercial
operators", resolved through an operator table, and asserted that `MTN` would resolve
to Mountain Air Cargo. I checked, with six live adsbdb lookups:

| callsign       | adsbdb                                         |
| -------------- | ---------------------------------------------- |
| UAL554         | United Airlines · New York → Dallas-Fort Worth |
| GJS4562        | GoJet Airlines · New York → Greensboro         |
| EJA837         | **NetJets · Bedford → Palm Springs**           |
| MTN8979        | **unknown callsign**                           |
| LXJ489, CXK369 | unknown callsign                               |

Two corrections. `MTN` does **not** resolve — the claim was wrong. And NetJets resolves
_with a route_, so a resolve-based gate would have published "NetJets from Bedford to
Palm Springs" — naming a fractional operator and its trip, which is worse on precisely
the axis the gate existed to protect.

**The gate I chose instead, from noticing why that route is dangerous.** Neither
endpoint is Newark. adsbdb infers routes from callsign history and NetJets reuses
callsigns across unrelated trips, so that route almost certainly is not this flight —
§14's "route enrichment wrong" risk. So: **name the operator and route only when a
route resolves AND one of its endpoints matches the airport we actually observed.**

That is a correctness check which happens to solve the privacy problem. It needs **no
maintained operator list**, cannot go stale, and is what §14 already asked for. It also
rejects the consultant's own option 2 (a charter denylist) for the reason the
consultant gave: unbounded, fails open, and no signal when stale.

Everything else is described in plain English by aircraft type, with emitter category
as the fallback. The callsign stays server-side for track keying and is stripped at the
WebSocket boundary, not merely hidden in the UI — otherwise devtools recovers it in
thirty seconds.

**What it costs:** per-note auditability, which is a genuine loss for a piece whose
first principle is that every sound is true. Verifiability moves up a level instead.

**One artistic point from the consultation worth keeping, because it is better than
anything in my framing:** Newark's airspace carries both the cheapest seats in the
country and the most expensive, and Teterboro is six miles away. A ticker that says
"a private jet departing Teterboro" in the same breath as "light rail arriving at
Warren St/NJIT" makes that stratification audible without editorialising. The
discipline is to let the juxtaposition do the work — "a private jet" is factual;
anything that scores a point would date badly and make the piece partisan.

**Also adopted:** routes are worth having for scheduled flights and are the most
evocative field in the piece — use city names, not airport codes. Give private
aviation a distinct timbre instead of an identifier, so "rewarding when you pay
attention" is recovered in the music rather than in the text.

**No code changes now.** Captions and the WebSocket payload are Phase 1. Recordings
are unaffected: private (tail-number) callsigns are already discarded, and
airline-pattern callsigns stay in the local, gitignored recordings for provenance and
tuning, where they are never published.

## 2026-10-14 · P0-5: event detection, and a deliberate strengthening of §3.2

**Edge detection, not state.** An aircraft climbing through the departure gate is
visible on several consecutive polls, so testing `altitude > gate` would retrigger
the same departure every 10 seconds. Every rule fires on a _transition_: crossing the
gate while climbing, entering a zone, transitioning to the ground.

**Hysteresis on zone exit** (`exit_hysteresis_km`, new in config). §6.4 holds a
sustained voice while an aircraft is inside the 3 km circle, so an aircraft loitering
on the boundary would restart that voice every poll. An aircraft must get clear of the
boundary by the hysteresis margin before it can trigger again — but a genuine second
pass still counts as a new event.

**§3.2's departure rule is strengthened, deliberately and with a flag.** As written it
is "within 4 nm of EWR, altitude rises through 1,500 ft with vertical rate > +500
ft/min, and the previous observation was on ground or below 500 ft". A **go-around**
satisfies all of that: descend to 300 ft, do not land, climb away. At a busy airport
that is routine rather than exotic, and it would be captioned as a departure that
never happened — a direct breach of §1.2, "every sound is true". So a departure also
requires either that the aircraft was seen on the ground in the track window, or that
its climb began from low altitude **with no descent before it**. A go-around has a
descent immediately before the climb; a departure does not. There is a test for it.

**Salience is a formula, in config, not a constant.** Base per type, plus a bonus for
category A5, scaled by distance with a configurable falloff. §6.5's governor keeps the
highest-salience events when the city is busier than the comfortable band, so this is
a priority order as much as a loudness — which is why a near heavy departure should
outrank a distant high overflight.

**`toPublicEvent` returns a new object rather than deleting keys.** Adding a sensitive
field to `attrs` later cannot silently start publishing it, and the entire public
surface is visible in one function a reviewer can read.

**Plain-English vocabulary, in config.** Type code first, emitter category as the
fallback, "a plane" as the floor. Deliberately a small closed vocabulary: this is a
caption, not an aircraft database, and "GLF4" is noise where "a Gulfstream" is legible.

**Verified against the live feed**, 90 seconds after deployment:

```
overflight_city  0.46  ✈ a helicopter over the city
helicopter       0.51  🚁 a helicopter crossing Newark
ewr_arrival      0.66  ✈ a heavy jet arriving at Newark
ewr_departure    0.52  ✈ an airliner departing Newark
```

The helicopter produced two events, which is correct — §6.4 gives each its own voice.
The heavy carries the highest salience. No caption contains an identifier.

**Observation for Phase 1 tuning, not a problem yet:** that is ~2.7 events/minute,
below §6.5's daytime band of 6–14. Aircraft alone will not fill the band; rail,
weather and the rest of Phase 2 are what §6.7 point 7 means by "the more independent
sources, the less predictable the result".

**Events are recorded to their own file.** Re-running a tuned detector over the raw
recordings should produce a _new_ event stream rather than appending to the old one,
and P0-8 spot-checks events specifically.

## 2026-10-14 · P0-5 review: five real defects, found by replaying real traffic

The reviewer replayed 38 minutes of the live recording (24,491 observations, 451
aircraft) through the real detector and mutation-tested the suite. Five confirmed
defects, two of them already written to append-only recordings.

**1. An arrival fired on a single spurious ground flag — and it is on disk.**
Event `01M4XZ5B847DFBYWJBK3W3SFAN`: a Sikorsky S-76, 0.73 nm from EWR, **climbing at
+896 ft/min**, captioned _"✈ a helicopter arriving at Newark"_. The event's own
payload contradicts its caption. Cause: low helicopters report `alt_baro: "ground"`
spuriously, and **190 of 285 aircraft flipped at least once in 38 minutes**. A ground
transition now also requires the aircraft not to be climbing and to be slow enough to
be on a surface. A direct §1.2 breach — the one principle that cannot be compromised.

**2. The go-around guard was defeated by one bad ground flag.** It returned true on
`track.some(o => o.onGround)` _before_ checking for a descent, so a single spurious
flag let a go-around through as a departure. Sustained ground contact
(`min_ground_observations`) is now required.

**3. The same guard's other branch was unreachable, and rejected real departures.**
It needed >1,000 ft of gain between consecutive observations — over 6,000 ft/min.
**0 of 17 real departures used it**, and it rejected a genuine one whose on-ground
segment had aged out of the window. A 500–700 ft/min climber needs 2–3 minutes to
reach 1,500 ft and the window's median span is ~132 s, so this is ordinary light and
reduced-thrust traffic. The guard is now: sustained ground contact, **or** a climb
with no descent anywhere behind it. A go-around always has the descent.

**4. Zone state could strand an aircraft "inside" forever.** Entry tested distance
AND altitude; exit tested distance only. An aircraft that stopped qualifying on
altitude while staying inside the radius never cleared, and its track never expires
while it keeps transmitting. Live data shows parked aircraft 3.3 km from the origin —
inside the 5 km helicopter zone — so **a based helicopter went permanently silent
after its first crossing**. Exit now mirrors the whole predicate, and landing clears
the state.

**5. One pass produced two captions.** An aircraft entering the circle below 10,000 ft
and climbing through it inside the circle — ordinary for a departure over Newark —
fired both `overflight_city` and `overflight_high`. The two zones now share one pass.

**6. `describe()` ignored `identity`,** the field that exists for exactly that
decision. Two Bombardier Global Express in the live sample, neither on an airline
callsign, both emitter category A3, were described as _"an airliner"_. §3.2 wants "a
large private jet". Added `by_category_private`.

**7. The recorder was an unfiltered event sink.** `toPublicEvent`'s allow-list
protected the WebSocket path only; `recordEvents` serialised the whole `CityEvent`.
§3.7 names the recordings as the sharp edge precisely because they cannot be unwritten.
Added `toRecordedEvent`. _Nothing was leaking today_ — the reviewer checked all
recorded events — but a field added to `attrs` later would have started appearing
silently.

**8. Config-as-data violations fixed:** the salience clamp (documented in a YAML
comment while the number lived in code), and the caption templates — half a caption
was tunable and half was not. `previous_below_ft` was accepted at boot and had no
effect; it is now unused and the real condition is documented.

**The test suite was the deeper problem.** Six independent mutations survived all 184
tests, including deleting the arrival's distance check entirely and deleting the
`retainOnly` call that prevents an unbounded state leak. The go-around test passed only
because its track had no ground observation — it could not distinguish "the guard
works" from "no departure fires without a ground observation", so this log's earlier
claim that "there is a test for it" was not true of the mechanism described. Added
regression tests for every finding, each written to fail against the old behaviour.

**Verified after the fixes, on the real recording:** 214 polls, 32,701 observations →
22 departures, 33 arrivals, 7 city overflights, 3 helicopters, and **zero suspicious
events** (no climbing arrivals, no mismatched glyphs). Detector states exactly matched
tracked aircraft (199 = 199), so nothing leaks.

**Flagged, not silently corrected (CLAUDE.md):** SPEC §3.2's amended text says
"B2 helicopter". The ADS-B emitter set defines **B2 as lighter-than-air**. The config
is right and that spec sentence is wrong. Noted in `config/sources.yaml`; SPEC left
for Mohammad to amend.

**Open, for tuning against the 48-hour recording rather than now:** 52% of
observations carry no vertical rate at all, and `?? 0` treats absent as zero — correct
in the fail-safe direction, but it means some real events are never detected. And the
arrival rule, unlike the departure rule, will still claim any airport inside 6 nm —
Linden is ~5 nm from EWR.

## 2026-10-14 · P0-6: the simulator, and a shared PRNG

**`shared/` is a new top-level directory — an addition to SPEC §5.1.** The seeded
PRNG now lives there because server and client must use _the same_ generator: the
simulator produces events the lab renders and the client jitters, and two copies of
"the same" algorithm that drifted apart would make a lab render disagree with what
listeners hear — which is the single thing §7.3's whole method depends on not
happening. Both tsconfigs include it.

**Replay and simulation are different tools and both exist.** A `Replayer` plays a
recorded day back at any speed, pull-based so the caller owns the clock — which is
what lets the lab render faster than real time and reproduce exactly. A `Simulator`
builds a _statistical_ model from recorded days and generates fresh events from it.
The distinction matters for the case the simulator exists for: if every source is down
for an hour, a looped replay becomes audibly a loop, and §6.7 names repetition as the
biggest risk to the whole piece.

**Honest by construction (§3.5, §1.2).** Everything either one emits carries
`sim: true` **and** says "(replay)" in its caption. Setting only the flag would leave
the ticker claiming a live departure; there is a test for each half. The simulator
also refuses to invent event types it never observed — it redistributes real traffic
rather than imagining it, which is as close to "nothing is invented" as a fallback can
get while still being a fallback.

**Takeover is deliberately slow and handback is immediate.** Two minutes of every
source being down before the simulator speaks, because swapping real traffic for a
replay over a ten-second blip is worse than a brief gap. It stands down the instant a
live source recovers: the real city always wins.

**A bug the tests caught in the fallback logic:** I measured the outage from the
simulator's own first tick rather than from when sources actually failed, so a server
started _during_ an outage would have waited the full takeover delay all over again.
Outage length now comes from the health registry's `lastSuccessAt`, which is the thing
that actually knows.

**Intensity 0.6, deliberately.** A fallback should sound like the city heard from
further away, not like a full house. Verified against the real recordings: a model
built from 51 real events produced 9 for a ten-minute window, every one marked.

**`/healthz` reports the simulator but is not made healthy by it.** A monitor must
still be able to tell a live city from a replay of one.

## 2026-10-14 · P0-8: the validation harness found a false caption before a human did

`lab/validate.ts` samples detected events stratified by type — so a rare type like a
helicopter is checked even though it is a small share of traffic, which is exactly
where a detector tends to be wrong — and writes a table for Mohammad to check against
a public flight tracker. It calls no tracking API: those terms are a separate question
we have not asked, and the point of §13's gate is a human looking at a tracker, not a
machine agreeing with itself. Simulated events are excluded, since validating a replay
against a tracker would be checking our recording against itself.

**On its first run it surfaced a real defect.** Row 3 read _"a small helicopter
arriving at Newark"_ at 40.7304, −74.1169 — a Jersey City heliport, 3.2 nm from EWR.
Inside §3.2's 6 nm arrival gate, and not Newark. The reviewer had flagged this as
_suspected_; the table confirmed it on real data.

The fix splits the two arrival branches, which were always doing different jobs: the
6 nm gate is right for spotting an **approach** — the aircraft is on its way in and
audibly so — but a **touchdown** must be on the airport. EWR's furthest runway
threshold is about 1 nm from the airport reference point, so 2 nm covers the field and
excludes the surrounding heliports. Re-replayed over the real recording afterwards:
zero touchdowns captioned as Newark from more than 2 nm away.

## 2026-10-14 · We earned an HTTP 429 from adsb.lol, and what it taught us

During P0-6/P0-8 development I rebuilt and force-recreated the container roughly a
dozen times in an hour. Each restart began polling immediately, and adsb.lol returned
**HTTP 429**. Entirely self-inflicted — the code was behaving as designed, the design
had a gap.

**What worked, unprompted:** backoff engaged, adsb.lol was marked `down` after three
consecutive failures, the supervisor failed over to adsb.fi, and the radio kept
collecting. §14's fallback chain under real pressure rather than in a test. The
supervisor's probe then brought us back to adsb.lol when it recovered — the exact
behaviour whose absence the P0-5 reviewer caught as unreachable code.

**The gap:** backoff state lives in memory, so a restart forgets it. Under
`restart: unless-stopped` an unattended crash loop would poll a volunteer-run service
as fast as it could restart — the same mistake as mine, but at machine speed and
without anyone watching. Added a jittered startup delay (4–8 s) before the first poll.
A few seconds costs nothing and makes a restart storm look like one client.

**The manners lesson, recorded because it will not be obvious to a future session:**
these are free services run by volunteers and they return **no rate-limit headers**
(docs/verification.md), so we cannot see we are being impolite until we are refused.
Rebuild-and-restart during development is a request to a stranger's server. Prefer
`npm run check` and the replay harness over restarting the live collector.

## 2026-10-14 · A helicopter with no emitter category — recognise rotorcraft by type code

Preparing the §13 spot-check table for Mohammad, one row (a Bell 407 crossing the
city at 800 ft) was captioned "✈ a plane over the city" and produced no `helicopter`
event at all.

**Cause.** `detection.helicopter` matched on `emitter_category: A7` only, and the
caption vocabulary had no entry for the type code `B407`. The aircraft broadcast
category **D0** — the "reserved" code, meaning no category — so the detector did not
see a helicopter and the caption fell through to the floor, `a plane`.

Replaying the day's observations shows **the same airframe reporting A0, A7 and D0 at
different times**, which is the general lesson and not one bad transponder: emitter
category is configured by hand on the ground, and is often absent or wrong. A type
code comes from the airframe and is not.

**Decision.** An aircraft is a rotorcraft if it matches **either** signal:
`detection.helicopter.type_codes` (21 types) **or** `emitter_category`. Both lists
live in `config/sources.yaml` — the detection list and the caption vocabulary — and a
test asserts every code in the detection list resolves to a caption containing
"helicopter", so the two cannot drift apart. Rejected the tempting alternative of
deriving one list from the other by matching the word "helicopter" in the caption
text: that makes behaviour depend on prose, which is the one part of config meant to
be freely rewritten.

Measured over the window both recordings cover: `helicopter` events 5 → 8, while
`overflight_city` (19) and `overflight_high` (2) are unchanged — the control showing
only the intended rule moved. The live container was **not** restarted for this; it is
inside the 48-hour recording the gate needs, and the fix reaches it at the next
natural restart.

## 2026-10-14 · [HUMAN] Phase 1's route naming needs the endpoint on the correct side

Found while gathering independent evidence for the same table, and flagged rather than
built, because the rule it changes is Mohammad's (§3.2 as amended).

The agreed rule is: name operator and route **only when a route resolves and one
endpoint matches the airport we observed**. Two rows show that is not quite enough. An
independent schedule database is keyed on the callsign and is **date-less** — it holds
one leg of a flight number, not that day's flight. For two arrivals into Newark it
returned Newark as the _origin_. Under the rule as written, EWR matches, and we would
caption an aircraft at 950 ft on final approach as "United 1499 **to** Los Angeles".

The repair is small: for an `ewr_arrival` the matching endpoint must be the
**destination**, and for an `ewr_departure` the **origin**; a match on the wrong side
is treated as no match and the caption stays type-based. Noted here so Phase 1's
route enrichment is written this way from the start, and so the correctness check that
§3.2 leans on actually carries the weight it was given.

## 2026-10-14 · [HUMAN] A date-less route lookup was wrong 5 times out of 5

Checking the §13 table against FlightAware settled every row where the callsign-keyed
schedule database failed to place Newark in the route. In all five the database was
describing a different flight entirely: ASA295 as LAX→SEA when it flew SEA→EWR,
RPA5829 as JFK→DCA when it flew EWR→BOS, UAL2392 as PHX→SFO when it flew BDA→EWR,
JZA497 as YSJ→YYZ when it flew EWR→YUL, JBU685 as JFK→RDU when it flew EWR→FLL. The
two rows that put Newark on the opposite side were then checked too and are the same
failure: UAL1499 as EWR→LAX when it flew AUS→EWR, RPA3584 as DTW→EWR when it flew
EWR→GSP. **Seven of thirteen callsigns wrong.**

The cause is structural, not a bad day: the lookup is keyed on callsign alone and
carries no date, so it returns one leg of a number that an airline reuses across days
and directions. Nothing we can configure fixes that.

**What held.** §3.2's rule — name operator and route only when an endpoint matches the
airport we observed — refused all five. The two wrong-side rows show why the direction
check matters as much: UAL1499 was at 950 ft on short final from Austin, and a
side-blind endpoint match would have announced it as a flight **to** Los Angeles. Without it we would have captioned an aircraft
at 900 ft on final approach as "an airliner **to** Seattle". The rule was written for
privacy and turns out to be the correctness guard as well.

**For Phase 1, Mohammad's call.** Either find a **dated** route source before §3.2's
route promise is implemented, or implement the promise only where it can be verified
and keep the type-based caption otherwise. The type-based captions were right in all
twenty sampled rows; the routes would have been wrong in four. §1.2 is better served
by saying less. Flagged rather than decided.
