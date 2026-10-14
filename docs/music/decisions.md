# Music decisions

Every entry: what changed, the expected audible effect, the lab numbers before and
after, and the human A/B result that justified adoption (SPEC §7.3, §7.5). Nothing is
adopted on numbers alone — Claude cannot hear (§7.2).

_No decisions yet. The first entry comes from Phase 0's P0-9 render, which only proves
the measurement loop works and is not a musical judgment._

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

---

## 2026-10-14 · The listening lab works end to end (P0-7)

Not a musical decision — the measurement chain is now proven, which is what §13
gates Phase 0 on.

**Chain:** a real aircraft event over Newark → recorded → replayed → rendered through
the real engine and master chain in headless Chromium via `Tone.Offline` → measured →
a report and a spectrogram.

**Determinism holds.** The same slice rendered twice gives an identical SHA-256, and a
different seed gives a different hash — the second check matters, because a renderer
that always produced silence would also be "bit-identical". The trap was the one
anticipated: `Tone.Reverb` builds its impulse response from `Math.random`, so the
deterministic preset omits reverb and the seeded PRNG replaces `Math.random`
**before Tone is imported**, since the IR is generated at construction.

**First numbers, from the probe fixture — these are NOT musical evidence:**

|                     |                                |
| ------------------- | ------------------------------ |
| Integrated loudness | −28.6 LUFS (target ≈ −20)      |
| True peak           | −7.0 dBTP (ceiling −1) ✓       |
| Onsets              | 1.3 / minute                   |
| Pitch-class entropy | 0.386 of 3.585 bits — 95% on D |
| Repetition score    | 0.993                          |

Every one of those is the _correct_ reading of a deliberately crude fixture: one bell
per event over a constant drone really is repetitive, really is stuck on D, really is
quiet. **The metrics diagnosing the fixture accurately is the evidence that the
metrics work.** Reports rendered from the probe now carry a banner saying so, because
a future reader — human or model — could otherwise mistake them for musical problems
and tune something to "fix" them.

The spectrogram confirms it visually: a continuous low band (the drone), four discrete
vertical spikes with harmonic series (the bells, matching the four onsets counted
independently), and nothing sustained above ~6 kHz, so §6.8's high shelf is working.

**What this does not tell us:** anything about whether it is pleasant. §7.3 step 5
still requires a human A/B win before any musical change is adopted, and the probe may
never be cited in one.
