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

## 2026-10-14 · The first aircraft voices

The first sound in this project that is allowed to be judged as music. (The probe
voice is not and never will be — see the top of this file.)

**Scale: D minor pentatonic.** §6.2 requires "no wrong notes, ever", and a pentatonic
is the only scale where that holds by construction: every pair of degrees is
consonant, so an event landing on any degree against any drone still works. The piece
has no harmonic walk yet to resolve a semitone, and will not until Phase 2's palettes.
Modes with semitones are strictly better _once there is somewhere for them to go_.

**Ground is a bare fifth, D2 + A2.** Omitting the third leaves the harmony undecided,
so an event note may colour it major or minor without ever contradicting the bed.

**Each gesture is a gesture, not a note** (§6.4). A departure rises, an arrival falls
with a softer attack, an overflight sustains, a helicopter flutters, a high overflight
shimmers. The attack difference between departure and arrival matters as much as the
direction: it is what makes the pair read as opposites to someone who is not
listening, which is most of the time.

**Climb rate sets the figure's speed.** An aircraft clawing for altitude hurries its
three notes along; one easing off lets them breathe. This is the one place the data's
own dynamics reach the music directly.

**Three findings from the first renders, all from numbers, none from ears:**

1. The first render was **silent in the events** and nobody would have known from the
   file size. A node-release optimisation written for the live page disposed each
   event's chain moments after it was scheduled, because in an offline render every
   event is scheduled before a single sample exists. The giveaway was the pitch-class
   histogram being _identical to four decimal places_ after an event-gain change.
   Releasing against the context clock rather than the scheduled time fixed it.
2. **Loudness must come from the Ground, not the master trim.** Pushing the trim
   raised integrated loudness by 0.3 LU per dB while driving true peak from −1.5 to
   −0.1 dBTP — over §6.8's ceiling. The drone carries the integrated figure because it
   is continuous; the events carry the peaks. They are different knobs.
3. **A sample-domain limiter at −1 dBTP does not produce −1 dBTP.** Measured −0.8 with
   the ceiling at −1. It is set to −1.5 so the spec is met after reconstruction.

**Open, and only ears can answer it:** how far forward the city voices should sit
against the Ground. The two renders logged in `listening-log.md` differ in exactly
that, at matched loudness.
