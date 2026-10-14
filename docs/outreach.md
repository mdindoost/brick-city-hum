# Outreach — access requests and attribution queries

Drafts for Mohammad to send. **Send the two access requests from an `@njit.edu`
address** — OpenSky's FAQ explicitly asks institutional applicants to do so, and it
makes the NJIT affiliation verifiable rather than asserted.

Log replies here with the date, and update `docs/verification.md` and SPEC §3.1 when
an answer changes a source's status.

| #   | To              | Purpose                                                  | Sent | Reply |
| --- | --------------- | -------------------------------------------------------- | ---- | ----- |
| 1   | OpenSky Network | written licence for operational use                      | —    | —     |
| 2   | airplanes.live  | API access for a non-commercial project                  | —    | —     |
| 3   | adsb.lol        | exact ODbL attribution wording (§12)                     | —    | —     |
| 4   | adsb.fi         | exact attribution wording + confirm 1 req/s (§12)        | —    | —     |
| 5   | adsbdb          | licence clarification: MIT vs the route-data restriction | —    | —     |

---

## 1 · OpenSky Network — `contact@opensky-network.org`

**Subject:** Licence request — non-commercial student art installation at NJIT

> Dear OpenSky Network team,
>
> I am a graduate student at the New Jersey Institute of Technology in Newark, New
> Jersey, writing on behalf of our Graduate Student Association. I would like to
> request a written licence to use the OpenSky REST API, as your Terms of Use §3(vi)
> requires for operational use.
>
> **The project.** "Brick City Hum" is a free, browser-based generative ambient
> radio: a continuous piece of music driven by live data about Newark. Aircraft
> movements around Newark Liberty, trains at Newark Penn Station, the weather and the
> tide in Newark Bay each become sounds, placed in space relative to our campus, so a
> listener hears the city from where we stand. It is a non-commercial art and
> education project for our student community. There is no charge, no advertising and
> no revenue of any kind, and there never will be.
>
> **What we would use.** `/api/states/all` with a bounding box of roughly 25 nautical
> miles around our campus, polled no more often than once every 25 seconds, and
> **only as a third-tier fallback** — we use adsb.lol as our primary source and
> adsb.fi as our first fallback, so in normal operation we would send you no requests
> at all. We expect to use a small fraction of the 4,000 daily credits of a registered
> account.
>
> **What we would publish.** We do not redistribute raw data. Positions are converted
> into musical events: a bearing, a distance, an altitude band, and a short human
> caption such as "a plane departing to the south". Listeners receive those events,
> not your data. We also follow a privacy rule of our own: for non-airline aircraft we
> show only the aircraft type, never a tail number or an owner.
>
> We would of course cite Schäfer et al., _Bringing up OpenSky_ (IPSN 2014), and
> credit the OpenSky Network on our attributions page, and send you a link to the
> finished piece. We would also keep OpenSky-derived data out of our permanent
> recordings, in line with §4(ii).
>
> If a licence is not something you grant for a project of this kind, a simple no is
> genuinely useful — we have a working fallback and would rather not use your data at
> all than use it outside your terms.
>
> Thank you for the network and for making the data available to researchers in the
> first place.
>
> With thanks,
> Mohammad Dindoost
> Graduate Student Association, New Jersey Institute of Technology

---

## 2 · airplanes.live — `contact@airplanes.live`

**Subject:** API access request — non-commercial student art project (Newark, NJ)

> Hello,
>
> Your API returned a 403 asking me to describe my project, so here it is.
>
> I am a graduate student at the New Jersey Institute of Technology in Newark, New
> Jersey. With our Graduate Student Association I am building "Brick City Hum": a
> free, browser-based ambient radio that turns live data about Newark into a
> continuous piece of music. Aircraft around Newark Liberty, trains at Newark Penn,
> the weather and the tide each become sounds, positioned in space relative to our
> campus — so you hear the city from where we are standing. Every sound traces back to
> a real event, and the page says in words what caused each one.
>
> It is entirely non-commercial: free to listen, no advertising, no revenue, now or
> ever. It is a student art and education project.
>
> **What I would request:** `GET /v2/point/40.742/-74.179/25`, once every 10 seconds
> from a single server. Clients never contact your API — our server polls once and
> fans the result out to listeners, which keeps us to one request per 10 seconds no
> matter how many people are listening. I would use adsb.lol as primary and would be
> glad to use you as a fallback, or the other way round, whichever you prefer.
>
> **What I need from a response:** position, altitude, vertical rate, ground state,
> callsign and **emitter category** — the category is what lets us give a helicopter a
> different voice from a heavy jet.
>
> I will credit airplanes.live with a link on our attributions page, and I will follow
> whatever attribution wording you prefer — if you have a standard form of words, I
> would rather use yours than invent my own. We also never publish tail numbers or
> owners for private aircraft.
>
> Happy to answer any question, and happy to be told no.
>
> Thank you for running the service,
> Mohammad Dindoost
> Graduate Student Association, New Jersey Institute of Technology

---

## 3–5 · Attribution and licence queries (lower priority, needed before the Phase 1 attributions page)

**adsb.lol and adsb.fi** — SPEC §12 requires exact attribution wording on our
`/attributions` page, and neither project publishes it anywhere we could find. Ask
both: _"What wording would you like for attribution? We will use yours rather than
guess. The project is a free non-commercial student art piece at NJIT; we poll one
point/radius query every 10 seconds from a single server."_ For adsb.lol, also ask
whether the ODbL attribution has a preferred form, and about the feeding programme
that their README says will earn an API key.

**adsbdb** — one GitHub issue, politely: the repository states an MIT licence, yet
also says the route data _"may not be copied, published, or incorporated into other
databases without the explicit permission"_ of the named contributors. Ask which
governs a short-lived in-memory cache of callsign→route lookups for a non-commercial
project. Until answered we keep that cache **in memory only, never written to disk**.
