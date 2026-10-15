# Deployment — hosting and the Cloudflare tunnel

SPEC §11. **Nothing in this file has been executed.** It is the plan, recorded now
while the facts are fresh, to be carried out when Mohammad says so.

## Decision: our own tunnel, on Mohammad's existing domain

Established 2026-10-15 by asking the **pishkar** session, which already runs a
Cloudflare tunnel on this laptop. Its answers were read live from the machine, not
from memory, and are reproduced here because they are the reason for the decision.

- **Domain: `pishkar.app`** — registered by Mohammad, on his own Cloudflare account,
  zone genuinely on Cloudflare (`sri.ns.cloudflare.com`, `cortney.ns.cloudflare.com`).
- `bot.pishkar.app` → `127.0.0.1:8081`, pishkar's live Vapi webhook.
- `hum.pishkar.app` does not exist and is free. **The hostname is Mohammad's choice,
  not ours** — it is his domain and pishkar is becoming a product on it.

**We do not share pishkar's tunnel**, and the decisive reason is theirs:

> `cloudflared` 2026.10.0 has no config reload — every ingress change is a
> `systemctl --user restart`, and Cloudflare's own documentation says long-lived
> requests such as WebSockets are dropped during one. `bot.pishkar.app` is a live
> phone line: Vapi posts every call event to it. A restart we caused to add our
> hostname would give a real caller a dead assistant for those seconds.

A silent radio is an annoyance; a dead phone line is somebody's actual call. A second
named tunnel costs nothing and removes the coupling entirely: a hostname is a CNAME to
`<tunnel-id>.cfargotunnel.com`, so `hum.pishkar.app` can point at our tunnel while
`bot.pishkar.app` points at theirs — same domain, same account, separate restarts.

## The steps, when the time comes

`cloudflared tunnel login` is a browser flow and **Mohammad's own action**; the
systemd unit needs his explicit yes (CLAUDE.md, "this machine"). Everything else is
ours to run, from this repo, touching nothing of pishkar's.

```bash
cloudflared tunnel login            # Mohammad: pick the pishkar.app zone
cloudflared tunnel create hum       # writes ~/.cloudflared/<uuid>.json
cloudflared tunnel route dns hum hum.pishkar.app
```

`config/cloudflared.yml` (ours, in this repo — **never** pishkar's copy under
`/home/md724/pishkar/data/cloudflared/`, whose `cert.pem` is Mohammad's account
certificate):

```yaml
tunnel: hum
credentials-file: /home/md724/.cloudflared/<uuid>.json
ingress:
  - hostname: hum.pishkar.app
    service: http://127.0.0.1:8080
  - service: http_status:404
```

No `originRequest` block, no `http2Origin`, no `disableChunkedEncoding`: a plain
`service: http://...` rule passes a WebSocket upgrade through unchanged, which
pishkar's working config demonstrates.

## What the network will actually do to us

pishkar measured five days of one tunnel process on this laptop, and it bears on ours
because it is the same machine and the same network:

- **36 reconnects in five days**, spread evenly across all four edge connectors.
- Worst simultaneous loss: **2 of 4 connectors, twice, about 12 seconds each**. Never
  3, never 4; the tunnel as a whole was never down.
- 27 of the 36 were `Application error 0x0 (remote)` — Cloudflare draining its own
  edge servers. Normal operation, and **not** something `--protocol http2` would fix;
  it would rename them. The DNS failures (`systemd-resolved` on an SRV lookup) are
  transport-independent too.

So: **our WebSocket will be cut a handful of times a day whatever we do.**

### What a listener hears when that happens — measured, not assumed

A real browser, playing, with the server killed mid-piece and restarted eight seconds
later:

|                                              |                             |
| -------------------------------------------- | --------------------------- |
| Minimum output level across the whole window | **0.147**                   |
| Silent samples (peak < 0.001)                | **0 of 110**                |
| Status afterwards                            | reconnected, events resumed |
| Errors                                       | none                        |

**The audio never stops.** The Ground layer is a set of oscillators in the listener's
own browser and owes nothing to the socket, so a dropped connection thins the event
stream for a few seconds and the bed plays through it. There is no seam to cross-fade.

Two things make that true and must not be "optimised" away:

- the client's **5-second clock probe** (§9.4), which also keeps the connection well
  inside Cloudflare's reported ~100 s WebSocket idle timeout — a quiet 4 a.m. stretch
  would otherwise look exactly like a dead connection;
- **reconnect with exponential backoff**, which is why the test above recovered at all.

## Boundaries agreed with the pishkar session

| Ours                                                                    | Theirs                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/home/md724/Brick-city-hum`, port **8080**, container `brick-city-hum` | `/home/md724/pishkar`, port **8081**, `pishkar-db`, `pishkar-tunnel.service` |

We do not read, write or inspect anything under `/home/md724/pishkar`, do not restart
their tunnel, and do not touch any tunnel or DNS record named `pishkar`/`bot`. They
have recorded the same undertaking towards ours.

**Also true and worth telling testers:** this is a laptop. It sleeps, it moves, its
address changes. Fine for a handful of listeners; not a service.
