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
