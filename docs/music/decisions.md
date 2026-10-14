# Music decisions

Every entry: what changed, the expected audible effect, the lab numbers before and
after, and the human A/B result that justified adoption (SPEC §7.3, §7.5). Nothing is
adopted on numbers alone — Claude cannot hear (§7.2).

*No decisions yet. The first entry comes from Phase 0's P0-9 render, which only proves
the measurement loop works and is not a musical judgment.*

---

## 2026-10-14 · The probe voice is a measurement fixture, not music

`lab/fixtures/probe-voice.ts` — one bell per event panned by bearing, plus one drone —
exists **only** so the render → LUFS → spectrogram → report chain can be verified
before Phase 1's real voices exist, and afterwards so the renderer can be regression
checked against a known hash.

**It will sound bad. That is not a defect, and it must never be tuned.** Do not
propose changes to it, do not read its lab numbers as an aesthetic signal, and do not
cite it in an A/B. If its output changes, the renderer changed — that is the whole
point of keeping it.

Phase 1's first real voices are the first thing in this project that may be judged as
music.
