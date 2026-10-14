# [VERIFY] results — Phase 0 and Phase 1 sources

Every [VERIFY] item SPEC.md marks for Phase 0/1, re-checked against the live source.
**All checks below: 2026-10-14.** These sources change; re-check before trusting an
old entry. Verdicts: `confirmed` · `changed` · `inconclusive` · `unavailable`.

> Where reality contradicts SPEC.md it is **flagged here, not silently fixed**.
> Flags needing a decision are collected in **§Contradictions** at the end.

---

## A1 · adsb.lol — primary aircraft source · **confirmed (with gaps)**

`GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}` → **HTTP 200**, HTTP/2,
`application/json`, ~52 KB for our real query (25 nm around NJIT), **114 aircraft**.
Route shape is current. Keyless confirmed.
Docs: <https://api.adsb.lol/docs> · repo: <https://github.com/adsblol/api>

**Envelope:** `ac` (array), `msg`, `now`, `total`, `ctime`, `ptime`.

**Per-aircraft fields** (counts out of 114 observed, so absence is normal and must be handled):

| Field | Type | Seen | Meaning |
|---|---|---|---|
| `hex` | string | 114 | ICAO 24-bit address — our track key |
| `flight` | string | 108 | callsign, **space-padded** (`"UAL1810 "`) — must trim |
| `alt_baro` | int \| `"ground"` | 46 int / 68 `"ground"` | barometric altitude in **feet**, or the **string** `"ground"` |
| `alt_geom` | int | 51 | geometric altitude; **absent on the ground** |
| `baro_rate` | int | 41 | barometric vertical rate |
| `geom_rate` | int | 30 | geometric vertical rate |
| `category` | string | 113 | emitter category, e.g. `"A3"`, `"A2"` |
| `lat`,`lon` | float | 114 | position |
| `gs` | float | 114 | ground speed |
| `t`, `r` | string | — | **type code** and **registration** — see privacy note |
| others | — | — | `dir`, `dst`, `track`, `seen`, `seen_pos`, `squawk`, `rssi`, `nav_*`, `mlat`, `tisb`, … |

**⚠ There is no boolean ground field.** Ground state is `alt_baro === "ground"` — a
string in a field that is otherwise an integer. A naive numeric parse yields `NaN`
and every parked aircraft reads as altitude zero or garbage. This is the single
most likely source of false departure events, so it gets its own test (P0-5).

Observed on the ground: `alt_baro: "ground"`, `gs: 2.2`, and `alt_geom`, `baro_rate`,
`geom_rate` **all absent**. Observed airborne: `alt_baro: 27025`, `alt_geom: 28250`,
`geom_rate: -1152`, `baro_rate` **absent** — so the detector must accept *either*
rate field and must not require both.

**Rate limits:** **no rate-limit headers at all** in the response (only `date`,
`content-type`, `content-length`, `vary`, `cache-control: no-store`). We therefore
cannot adapt to load and must stay conservative by design. Repo README, quoted:

> "Rate limits are dynamic based on the environment load. If you get 4xx errors, you
> are doing something wrong. In the future, you will require an API key which you can
> obtain by [feeding adsb.lol](https://adsb.lol/feed)."

Undated. Matches SPEC's "dynamic" and the announced key requirement (§14 already
budgets for this). README also states it is "a drop-in replacement" for the
ADSBExchange Rapid API.

**Attribution: `inconclusive`.** No ODbL wording found in the README, the homepage,
or the docs (which is a JS single-page app with no extractable text). Only the
non-authoritative comparison page calls it "ODbL data". **SPEC §12 requires exact
attribution wording and we do not have it** — tracked as a Phase 1 blocker, not a
Phase 0 one.

---

## A2 · adsb.fi — first fallback · **changed**

**Working route:** `https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}`
→ **HTTP 200** (Cloudflare, no rate-limit headers), 113 aircraft.
The documentation URL `https://opendata.adsb.fi/api/` returned **HTTP 400** and could
not be read.

**SPEC says "ADSBx v2 schema", which is only half right:**

- **Per-aircraft fields match adsb.lol exactly** — `alt_baro` (same `"ground"`
  string convention), `alt_geom`, `baro_rate`, `geom_rate`, `category`, `flight`,
  `hex`, `lat`, `lon`, `gs` — plus extra `desc`, `ownOp`, `year`.
- **The envelope differs**: the aircraft list is `aircraft`, **not `ac`**, and
  `msg` / `total` / `ctime` are absent (`now`, `aircraft`, `resultCount`, `ptime`).

**Consequence:** one parser serves both *if* it reads the list as `ac ?? aircraft`
and does not depend on envelope metadata. That is a one-line adapter, and it is
exactly the kind of thing §14's "adapters isolated per source" is for. Worth knowing
now rather than at 3 a.m. when A1 fails over.

**Rate limit (1 req/s) and non-commercial terms: `inconclusive` from any primary
source.** Both appear only on the non-authoritative comparison page. Until confirmed,
treat 1 req/s as a hard ceiling and assume non-commercial-only — the conservative
reading in both directions.

---

## A3 · OpenSky Network — second fallback · **changed · ⚠ possible licence blocker**

Docs: <https://openskynetwork.github.io/opensky-api/rest.html> ·
terms: <https://opensky-network.org/about/terms-of-use>

**Basic auth really is gone.** Docs, verbatim: *"Basic authentication with username
and password is no longer accepted."* The **March 2026 date SPEC cites is not stated
on the page** — `inconclusive`, though immaterial since the removal is confirmed.

**OAuth2 client credentials — confirmed:**
```
POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials&client_id=…&client_secret=…
→ then:  Authorization: Bearer <token>  on  /api/states/all?lamin=..&lamax=..&lomin=..&lomax=..
```
**Token lifetime 30 minutes**; on 401, request a new one — no refresh grant. (Their
own Python example re-requests 30 s before expiry.) Not executed: we have no
credentials. Which account page issues them, and whether registration is free:
`inconclusive`.

**Credits — confirmed, and SPEC is right:** anonymous **400/day**, standard
registered **4,000/day**, active feeder (≥30 % uptime/month) 8,000/day.
`/states/all` cost by bbox area in square degrees: **≤ 25 → 1 credit**, 25–100 → 2,
100–400 → 3, > 400 or global → 4. Our 25 nm box is well under 25 sq deg → **1 credit**.
A live unauthenticated probe returned `x-rate-limit-remaining: 399`, consistent with
a 400/day anonymous bucket and a 1-credit cost.

**Documented time resolution is 5 s** for registered users; no separate minimum poll
interval. Our ≥ 25 s third-tier polling is comfortably compatible.

**⚠ Units differ from adsb.lol — `/states/all` is a positional array in metres:**

| idx | field | type | unit |
|---|---|---|---|
| 0 | `icao24` | string | — |
| 1 | `callsign` | string | — |
| 2 | `origin_country` | string | — |
| 3 | `time_position` | int, nullable | unix s |
| 4 | `last_contact` | int | unix s |
| 5 | `longitude` | float, nullable | deg |
| 6 | `latitude` | float, nullable | deg |
| 7 | **`baro_altitude`** | float, nullable | **METRES** |
| 8 | `on_ground` | bool | — |
| 9 | `velocity` | float | **m/s** |
| 10 | `true_track` | float | deg |
| 11 | **`vertical_rate`** | float | **m/s** (+climb) |
| 12 | `sensors` | int[] \| null | — |
| 13 | **`geo_altitude`** | float, nullable | **METRES** |
| 14 | `squawk` | string, nullable | — |
| 15 | `spi` | bool | — |
| 16 | `position_source` | int | — |
| 17 | `category` | int 0–20 | — |

adsb.lol gives **feet** and **ft/min**; OpenSky gives **metres** and **m/s**, and its
`category` is an **integer** where adsb.lol's is a string like `"A3"`. Our §3.2
thresholds are written in feet and ft/min. **Every one of these must be converted in
the collector, never downstream** — the normalizer is the single place units are
allowed to differ. Note for the reviewer: a unit mix-up here would not crash, it
would just make the city sound wrong, which is far harder to notice.

**⚠ Licence — the real problem.** The terms (read via search summary; **verify on
the page directly before relying on OpenSky at all**) indicate: non-commercial
research and education is the basis of free access; **operational or live-product use
appears to require a written licence from OpenSky even for non-profits**; data "may
not be passed outside the institution"; publications must cite OpenSky.

Brick City Hum is a public, live, non-commercial art project that would stream
OpenSky-derived data to anyone with the link. That looks like exactly the
"operational/live product" case. **This is a direct contradiction of SPEC §3.1's plan
to use OpenSky as fallback A3** — flagged below, not resolved.

---

## A4 · adsbdb — route enrichment · **confirmed shape · ⚠ licence contradiction**

`GET https://api.adsbdb.com/v0/callsign/UAL123` → **HTTP 200**. Keyless confirmed in
practice (only `PATCH` needs auth). Server header reports `v1.0.0` while the path is
`v0` — the repo documents paths as `/v{semver.major}/`, and no newer major exists.
Repo: <https://github.com/mrjackwills/adsbdb>

```jsonc
{"response":{"flightroute":{
  "callsign":"UAL123","callsign_icao":"UAL123","callsign_iata":"UA123",
  "airline":{"name":"United Airlines","icao":"UAL","iata":"UA","country":"United States",…},
  "origin":     {"iata_code":"LHR","icao_code":"EGLL","name":"London Heathrow Airport","municipality":"London",…},
  "destination":{"iata_code":"IAD","icao_code":"KIAD","name":"Washington Dulles International Airport",…}
}}}
```
Airports carry **both** IATA and ICAO codes plus a human name and municipality —
everything §6.4 captions need ("United to Chicago"). Airline name is `airline.name`.

**Not found:** `GET /v0/callsign/ZZZ99999` → **HTTP 404**, body
`{"response":"unknown callsign"}`. Note the type change: `response` is an **object**
on success and a **bare string** on failure. Parse defensively.

**Rate limits:** none documented, none in headers — `inconclusive`. SPEC's
per-callsign-per-day cache is therefore good manners regardless.

**Route accuracy:** SPEC says routes are inferred from callsign history and can be
wrong. The repo makes **no such caveat** (it only asks users to report bad data) —
`inconclusive`. SPEC's §14 mitigation ("show the route only when confident") still
stands on its own merit; note the UAL123 sample returns a London→Washington route,
which a Newark-departure caption would have to be careful with.

**⚠ Licence contradiction, both quotes from the same repo page:** licence stated as
**MIT**, yet route data is credited to named individuals with the restriction that it
*"may not be copied, published, or incorporated into other databases without the
explicit permission"*. Our per-callsign daily cache is arguably a copy. Flagged below.

**⚠ Privacy — this one changes our code.** `GET /v0/aircraft/{hex}` returns type
**and** registration **and** owner in a single response:
```jsonc
{"response":{"aircraft":{
  "type":"R44 Astro","icao_type":"R44","manufacturer":"Robinson","mode_s":"A0B1C2",
  "registration":"N144CD","registered_owner":"Blue Ridge Helicopter Services Inc",
  "registered_owner_country_name":"United States","url_photo":"https://…" }}}
```
There is **no type-only endpoint**. SPEC §3.2 forbids showing tail numbers or owners
for non-airline aircraft, so the collector must **strip `registration`,
`registered_owner*`, `mode_s` and the photo URLs at the normalizer boundary** — before
anything reaches the event bus, the WebSocket, a caption, a log line, or
`data/recordings/*.ndjson`. Recordings are the sharp edge: they are append-only and
long-lived, so leaking a tail number there is not undoable by a later code fix.
Same applies to adsb.lol's own `r` (registration) and `t` (type) fields.

---

## Contradictions and open flags

**I have not changed the design for any of these. Each needs your decision.**

1. **OpenSky licence vs. our use case (A3).** Their terms appear to require a written
   licence for live/operational use, even non-profit. We are live, public and
   non-commercial. Options: (a) ask OpenSky directly for written permission for an
   NJIT non-commercial art project — slow but clean, and they are research-friendly;
   (b) drop A3 and rely on adsb.lol → adsb.fi → simulator, which is already three
   deep; (c) keep A3 but gate it behind a config flag, off by default, pending
   permission. **My recommendation: (b) for now with (a) started in parallel** — the
   fallback chain stays honest, nothing blocks Phase 0, and if OpenSky says yes we
   flip a flag. *Note: this contradicts SPEC §3.1 row A3 and §14's A1→A2→A3 chain,
   so SPEC.md needs an edit once you decide.*
2. **adsbdb licence (A4): MIT vs. the route-data restriction.** Options: ask the
   maintainer; or cache in memory only for the session and never persist routes;
   or caption by airline alone and skip routes entirely. **My recommendation: ask
   the maintainer (one GitHub issue) and meanwhile keep the cache in memory only,
   not on disk** — it keeps Phase 1 moving without publishing anyone's database.
3. **Attribution wording is missing for adsb.lol and adsb.fi.** §12 requires exact
   wording on `/attributions`. Blocks the Phase 1 attributions page, not Phase 0.
   I would email or open an issue with both projects and quote whatever they reply.
4. **adsb.fi's 1 req/s and non-commercial terms are unconfirmed from a primary
   source.** We treat both as binding until proven otherwise. No action needed.
5. **SPEC's March 2026 date for OpenSky basic-auth removal is unverifiable** on the
   docs page. Immaterial — the removal itself is confirmed. No action.

---

## H1 · Cloudflare Quick Tunnel + WebSockets · **limits confirmed · central question inconclusive**

Source: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>

Still stated today, verbatim:
> "Quick Tunnels have no uptime guarantee."
> "Each Quick Tunnel supports up to 200 in-flight requests. Additional requests return a `429` response."
> "Quick Tunnels do not support Server-Sent Events (SSE)."
> "The hostname changes each time you create a Quick Tunnel."

So SPEC §11.1's limits are accurate. Two refinements:

**Does an open WebSocket occupy one of the 200 slots? `inconclusive`.** No Cloudflare
page defines "in-flight", and none addresses upgraded WebSockets. The only WebSocket
statement found is on the general Tunnel FAQ — *"Yes. Cloudflare Tunnel has full
support for Websockets."* — which is about Cloudflare Tunnel **in general, not Quick
Tunnels**. SPEC §11.1 asserts "WebSockets work" under the Quick Tunnel heading; that
is true of Tunnel generally but not separately documented for Quick Tunnels. No
GitHub issue or forum thread reporting 429s from long-lived WebSockets on a Quick
Tunnel was found — which is weak evidence either way, not reassurance.
**SPEC's worst-case plan of ~150 concurrent listeners stands, and the cheapest way to
settle it is our own Phase 1 load test, not more reading.**

**⚠ New finding SPEC does not mention — an idle timeout that will disconnect listeners.**
<https://developers.cloudflare.com/network/websockets/>:
> "Cloudflare will close a WebSocket connection when no data is transmitted in either
> direction for a period of time."

**No numeric value is published** (configurable only for Enterprise). A community
thread reports ~100 s, unverified. Separately, Cloudflare documents a Proxy Read
Timeout of 125 s, Enterprise-configurable; whether it applies to idle WebSockets is
`inconclusive`. Cloudflare's own advice is to *"implement a client-side heartbeat
(ping/pong) mechanism"*, with no interval given.

**Why this is good news for us:** SPEC §9.4 already pings every 30 s for clock sync,
which doubles as that heartbeat and sits comfortably under even the pessimistic
~100 s. **Nothing needs to change** — but the 30 s interval is now load-bearing for
connection survival, not just clock accuracy, and anyone tempted to relax it later
should know that. Worth a comment in `clocksync.ts`.

Also documented: *"When Cloudflare releases new code to its global network, we may
restart servers, which terminates WebSockets connections."* Unscheduled drops are
normal, so **auto-reconnect with backoff belongs in every client**, not only in
lounge mode (§2.2). No max connection duration or bandwidth cap is stated.

**⚠ Named tunnel (Phase B) — this affects your domain decision (§11.2, question 1).**
Prerequisites: a Cloudflare account, **a domain on Cloudflare**, and a host for
`cloudflared`; publishing creates a proxied CNAME to `<TUNNEL_ID>.cfargotunnel.com`.
The Tunnel FAQ says Tunnel can be used with "Partial Setup" (CNAME-only, DNS stays
elsewhere) — **but partial setup is Business or Enterprise plan only**
(<https://developers.cloudflare.com/dns/zone-setups/partial-setup/>).

**Inference, not stated outright for tunnels: on the free plan the domain must use
Full Setup — i.e. its nameservers must point at Cloudflare.** If GSA's DNS lives
elsewhere and GSA will not delegate nameservers, then SPEC §11.2 option (b) — a GSA
subdomain on a named tunnel — **is not available on a free plan**. The fallback §11.2
already names (GSA domain redirects to our domain) would still work. Whether named
tunnels drop the 200-request limit and the SSE exclusion is **not stated anywhere** —
treat as unconfirmed rather than assumed.

---

## P1 · Newark coordinates (§3.2 "verify with a map") · **4 confirmed, 1 changed**

Checked against Wikipedia infoboxes (DMS → decimal) and the FAA-derived airnav record
for EWR. Errors are the distance from SPEC's value to the reference.

| Point | SPEC value | Reference | Error | Verdict |
|---|---|---|---|---|
| NJIT (origin) | 40.7420, −74.1790 | 40.74194, −74.17889 | ~11 m | **confirmed** |
| EWR ARP | 40.6925, −74.1687 | 40.69248, −74.16869 (airnav/FAA) | ~2–8 m | **confirmed** |
| Newark Penn | 40.7345, −74.1638 | 40.73472, −74.16417 | ~39 m | **confirmed** |
| Prudential Center | 40.7335, −74.1711 | 40.73361, −74.17111 | ~12 m | **confirmed** |
| **Port Newark** | **40.68, −74.15** | **40.6816, −74.1505** | **~180 m** | **changed** |

All four confirmed values are inside their reference's own precision and are fine as
written. **Use 40.6816, −74.1505 for Port Newark** — only a Phase 3 concern (ships),
and 180 m is musically irrelevant at that distance, but there is no reason to carry a
worse number into `config/places.yaml`.

**EWR runway geometry** (airnav, FAA-derived; single-source for the 11/29 pair, so
treat as good-enough-for-sanity-checks rather than survey truth):

| Runway | Threshold | True hdg | Length |
|---|---|---|---|
| 04L | 40.675381, −74.179449 | 026° | 11,000 ft |
| 22R | 40.702560, −74.162172 | 206° | 11,000 ft |
| 04R | 40.677584, −74.174245 | 026° | 9,999 ft |
| 22L | 40.702289, −74.158537 | 206° | 9,999 ft |
| 11 | 40.702804, −74.180707 | 095° | 6,725 ft |
| 29 | 40.701199, −74.156543 | 275° | 6,725 ft |

Two parallels on ~026/206 plus one crosswind on ~095/275. **This is for sanity
checks only — §3.2 forbids assuming a flow direction, and that still holds**: flow
flips with the wind, often twice a day. Useful for P0-8 validation ("does this
detected departure's track actually align with a real runway?") and later for placing
the runways in the §10 map. Not an input to detection.

---

## A3 (re-check) · OpenSky terms, read in full · **requires written permission — settled**

Checked 2026-10-14 by reading <https://opensky-network.org/about/terms-of-use> and
their FAQ in full (both 403 to a plain fetch; readable with a browser User-Agent).
The earlier entry above rested on a search snippet; this supersedes it.

**Terms §3 "USE RESTRICTIONS" (vi), verbatim:**
> "The REST API is provided for non-profit research and educational use only. Use of
> the REST API in any operational capacity — including but not limited to integration
> into a live product, service, or automated system — requires a written license from
> OpenSky Network, regardless of the entity's non-profit status."

**Terms §1 "LICENSE":** grants a licence "solely for the purpose of non-profit
research and non-profit education", adds that operational use "also requires a
written license, regardless of the entity's non-profit status", and closes:
> "No license is granted for any other purpose and there are no implied licenses in
> this AGREEMENT."

The same requirement appears a third time in the page's own Tl;dr. Their FAQ Q7 is
looser — *"You can freely use the API for personal and non-profit applications"* —
and **contradicts the Terms**. The Terms declare themselves "legally binding under
the laws of the Swiss Confederation" and are the more specific text on operational
use, so they control. Relying on the FAQ sentence would be relying on the weaker of
two conflicting statements.

Our use — a server polling on a schedule and feeding a live public WebSocket — is
squarely "a live product, service, or automated system". NJIT affiliation does not
help by itself: the allowance is for *research and education*, and a public art
installation is neither as the text is written.

**Two further clauses that constrain the architecture, not just the paperwork:**

- **§4(ii) conflicts with our recorder.** All copies of received data must be expunged
  "upon completion or termination of stated research and/or termination of data access
  or use." §3.5 keeps `data/recordings/*.ndjson` indefinitely, and the simulator and
  listening lab are built on it. **Even with a licence, OpenSky-derived observations
  must never be written into the permanent recordings** — they would have to be
  deletable, and our recordings are deliberately append-only.
- **§4(i) names web pages explicitly.** Any publication "including web pages" using
  their data must cite Schäfer et al., *Bringing up OpenSky*, IPSN 2014, and OpenSky
  must be sent a copy or link. A §12 obligation if we ever enable it.
- **§3(iii)** forbids passing "the data set(s)" to anyone not "employed by your
  institute". It draws **no raw-vs-derived distinction**, so whether abstracted
  musical events count is genuinely unresolved by the text — moot while §3(vi) already
  requires a licence.

**Licence requests:** `contact@opensky-network.org`, with a brief description of the
use. Their FAQ adds: *"If you are from an eligible institution, please use an
affiliated email address!"* — so this one request is materially stronger from an
`@njit.edu` address than from a personal one.

**Verdict: `requires written permission`.** SPEC §3.1 row A3 and §14's A1→A2→A3 chain
cannot be relied on until OpenSky grants a licence.

---

## Alternative aircraft sources, surveyed · **the free-API landscape is closing**

Checked 2026-10-14. Searched for a third fallback whose licence clearly permits a
live, public, non-commercial project.

| Candidate | Access today | Licence fit | Verdict |
|---|---|---|---|
| **airplanes.live** | **HTTP 403 — gated** (see below) | guide header says "Non-Commercial Use" | **ask first** |
| adsb.one | appears archived ~April 2026, merged into airplanes.live | — | not viable |
| ADS-B Exchange | commercial licence language; free feeder key disputed | "commercial use, for-profit **or non-profit**, requires a written license" | ask first / unclear |
| FlightAware AeroAPI | paid, ~$0.05 per result set; $5/mo free credit | free tier limited to "personal or academic" derivative works | not viable — per-query cost alone rules out 10 s polling |
| HexDB.io | keyless | — | not viable: **no positions**, metadata only |
| plane.watch · theairtraffic.com | no consumer read API found (feed-in only) | — | not viable |
| Planefinder · Wingbits · Aviation Edge | commercial | — | inconclusive, likely paid |

**airplanes.live is no longer keyless.** A single live probe of
`https://api.airplanes.live/v2/point/40.742/-74.179/25` returned **HTTP 403**:
> `{"error": "Please contact us at contact@airplanes.live. Your email MUST include any links, a description of the project, and any information you deem appropriate."}`

So its `category` field could not be confirmed, which matters: §3.2's `helicopter`
(A7) and `heavy` (A5) rules depend on emitter category. Its schema is reportedly
ADSBx v2-compatible like adsb.lol and adsb.fi, but that is inference until we can see
a real response.

**The pattern is the finding.** OpenSky requires a written licence; airplanes.live
gates on an emailed project description; ADS-B Exchange's wording covers non-profits
too; and adsb.lol's own README says a key *"will"* be required, obtainable by feeding
them. Free, unconditional, keyless ADS-B is disappearing. §14 anticipated this for
adsb.lol specifically; it is in fact the whole market.

**Which makes our own receiver the only option with no licence question at all:** an
RTL-SDR dongle (~$85 with a dipole kit; ~$80–160 all in) plus a 1090 MHz antenna,
running `readsb` (the maintained `dump1090` fork) with `tar1090`. We would own the
data outright, so no aggregator's terms touch the music. Feeding that data to
adsb.lol is also exactly how their README says the future API key is earned, which
closes the §14 risk from the other end. Limitation, unavoidable and physical: one
receiver needs line of sight, so it will miss low and distant aircraft and cannot
replace a network view — it is a strong **complement**, not a drop-in substitute.
Realistic rooftop reception radius in urban Newark: `inconclusive`, no sourced figure
found.
