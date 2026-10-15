# Listening log

Human listening sessions and blind A/B results. The panel rates each render 1–5 on
_pleasant_, _alive_, _annoying_, _would leave it on_ (SPEC §7.3 step 5). Only changes
that win are adopted.

| Date       | Render A                              | Render B                              | Listeners | Pleasant | Alive | Annoying | Leave it on | Winner    | Notes                                                                              |
| ---------- | ------------------------------------- | ------------------------------------- | --------- | -------- | ----- | -------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| 2026-10-14 | `aircraft-with-reverb-ground-forward` | `aircraft-with-reverb-voices-forward` | _pending_ |          |       |          |             | _pending_ | First round. One variable: how far forward the city voices sit against the Ground. |

### Round 3 — 2026-10-15 — struck samples, and how far forward the city sits

`v3-forward-5` and `v3-forward-9`. Same six minutes of real traffic as round 2, same
540 events, so the only thing that changed from that round is the instruments — and
between these two files, the only thing that changes is one number.

**What is new.** Four of the five aircraft voices now play CC0 samples instead of
oscillators: marimba for departures, vibraphone for arrivals, tubular bells for
overflights, glockenspiel for the high ones, concert harp for ring crossings. That is
round 2's verdict taken literally — "as if someone was really striking the note" is a
description of a transient, and no oscillator has one. The reasoning and the four
things that had to be measured are in `decisions.md`.

**The one variable between A and B** is `master.voices_gain_db`, how far forward every
event sits against the Ground. This is the question this log has had open since round
1 and never actually asked, because until now there was no single number for it.

|                            | A — `v3-forward-5` | B — `v3-forward-9` |
| -------------------------- | ------------------ | ------------------ |
| the city against the drone | drone 5 dB over    | within a decibel   |
| integrated                 | −21.4 LUFS         | −21.1 LUFS         |
| true peak                  | −5.3 dBTP          | −2.0 dBTP          |
| limiter                    | never engages      | never engages      |

**What to listen for, in order:**

1. **Does it sound like someone striking a note?** That is the whole round. If the
   answer is still no, the instruments are wrong and the balance does not matter.
2. Which of the two would you still want on after ten minutes?
3. Can you tell a departure (marimba, dry) from an arrival (vibraphone, ringing)
   without looking?
4. In B, does the Ground stop being the air and become just another voice? In A, do
   the events ever disappear under it?
5. Anything harsh, and any single event that jumps out of the mix.

Ratings go in the table at the top of this file; whichever wins becomes the default in
`score.yaml`.

**Result: void.** The files contained the harp, the helicopter, the PATH bell and the
Ground, and nothing else. `manifest.json` listed one kit of five, and a voice whose kit
is missing is left out by design — so marimba, vibraphone, tubular bells and
glockenspiel were never in the render. The round's one question was asked of a file in
which 89% of the events were a single harp sample. The two numbers above that read as
evidence about the samples were measuring four absent voices. See
`docs/decisions.md`, and `decisions.md` here for what it says about trusting the lab.

Re-rendered as round 4 with the same slice, the same seed and the same two values of
`voices_gain_db`, so the comparison survives intact.

### Round 2 — 2026-10-15 — density, no clicks, minor vs major

Same six minutes of real traffic through the distance rings and the governor;
`v2-minor` and `v2-major` differ only in the palette's scale, at matched loudness.

**Result: both lost again**, and the verdict names the real problem.

> "Neither. It still has something like background noise and no musical feeling. I
> don't see much difference between them. Around 2:30 when the number of events went
> up it became a little bearable; 3:36 a bit better; 3:57 the sounds had changes. What
> I heard on Wikipedia wasn't like this — **it was as if someone was really playing a
> note**."

Three things follow, and only the third is about taste.

1. **The clicks are gone and it still sounds like noise**, so the noise was never only
   the clicks. Our voices are sine and triangle oscillators with slow attacks and long
   releases; several of them overlapping is a wash by construction. A wash is what a
   listener calls background noise no matter how in-tune it is.
2. **"Someone really playing a note" is the whole brief for the next musical round.**
   What that describes is a struck or plucked attack with a decaying body — a
   transient the ear can locate in time — rather than a tone that fades in. The PATH
   bell is already the right shape; the aircraft voices are not. §6.9's "synthesis
   first" does not require that synthesis be sine waves, and VCSL and VSCO 2 CE are
   CC0 and full of struck instruments.
3. **The moments he could name were the busy ones** (2:30, 3:36, 3:57). More events
   made it more bearable, which is the same direction as his earlier note and the
   reason the next work is density rather than timbre.

**Direction, from Mohammad:** stop tuning the notes for now. Push the event count as
far as it will honestly go, leave the page's beauty for later, and come back to the
sound with a better idea.

### Round 1 — 2026-10-14 — the first aircraft voices

The same 10 minutes of real Newark traffic (14 Oct, 15 events), the same seed, the
same voices. **A** has the Ground at 0.26 and no master trim; **B** halves the Ground
and adds 2.5 dB of trim, so the aircraft sit further forward.

Listening copies are **level-matched by a fixed −3.8 dB on A** and nothing else — no
compression, no normalisation of either file — because the louder of two renders wins
an A/B regardless of merit, and `loudnorm` would have changed B's dynamics, which is
the very thing under test. Both measure −24.3 LUFS as encoded. The shipped default
(A, unattenuated) measures −20.0 LUFS, which is §6.8's target exactly.

|                                   | A — ground forward | B — voices forward |
| --------------------------------- | ------------------ | ------------------ |
| Integrated loudness (as rendered) | **−20.0 LUFS**     | −23.8 LUFS         |
| True peak                         | −1.9 dBTP          | −1.1 dBTP          |
| Loudness range                    | 5.4 LU             | 11.1 LU            |
| Onsets detected                   | 0.5 /min           | 1.7 /min           |
| Repetition score                  | 0.991              | 0.966              |

The numbers lean towards B — more detected onsets, less repetition, a wider loudness
range all read as "more alive". **They are not the decision.** Every one of them is
also consistent with B simply being more exposed and therefore more tiring over an
hour, which is the failure mode §1.4 cares about most and which no number here
measures. A's 0.991 repetition score is what an unobtrusive bed looks like to a
self-similarity measure.

**What to listen for, in order:**

1. Over ten minutes, which one would you still want on? That is the whole question.
2. Can you tell a departure from an arrival without looking? If not, the attack
   difference is too subtle and that is a fixable number.
3. Does anything sound harsh, or does any single event jump out of the mix?
4. Does the Ground ever become the subject rather than the air?

Ratings go in the row above; whichever wins becomes the default in `score.yaml`.

**Result: both lost.** Mohammad's verdict, 2026-10-14: _both are boring, there are far
too few events, and the music should be brighter._ No rating was given for either and
none was needed — asking which of two beds is better placed is the wrong question when
the city is only speaking 1.4 times a minute. §1.4 names boredom as the thing to avoid
and this round found it in ten minutes, which is the listening workflow working
exactly as §7 intends: the numbers said "A meets the loudness spec" and a person said
"I would turn it off".

Three directions follow, in his order: **more events first, faster change, then the
music itself.** The first is measured, not a guess — see `docs/decisions.md`, the
entry on the sky we were throwing away.

_Phase 1 gate (§13): median "would leave it on" ≥ 3.5/5 across 10–20 testers._

### Round 4 — 2026-10-15 — five instruments, and whether the city is audible at all

Round 3 re-rendered with every kit present (`v4-all-5`), plus a second render that
changes one thing: the balance between the events and each other.

**What the analytic levels say, before any listening.** Each event's peak comes out of
`engine.schedule` as `voice.gain × distance × (0.4 + 0.6 × salience) × tier`, so the
whole distribution can be computed from the recording without rendering anything. For
the same six minutes, at `voices_gain_db: 5`:

| voice             | events | median peak | loudest |
| ----------------- | ------ | ----------- | ------- |
| `sky`             | 611    | −24.8 dBFS  | −15.0   |
| `altitude_band`   | 62     | −26.5       | −17.6   |
| `ewr_arrival`     | 5      | −5.4        | −5.2    |
| `ewr_departure`   | 3      | −5.5        | −5.3    |
| `overflight_city` | 2      | −8.4        | −8.4    |
| `helicopter`      | 1      | −15.0       | −15.0   |

The Ground measures −22.6 LUFS, about −19 dBFS peak. **So the median event in this
piece peaks about 6 dB below the drone, and the named events are 20 dB above the
carpet.** That is not a dense ambient piece; it is a drone with a rare loud note. It
is also, read back against round 2's verdict — _"there are far too few events"_ — a
better explanation of that verdict than the one acted on at the time: the events were
there, at eighty a minute, and almost none of them cleared the bed.

Measured in the same window, no band of the mix shows a transient structure at all:
median to maximum frame energy is 2–3 dB above 700 Hz, where a struck note should be
obvious. The rewritten onset detector finds 9 onsets a minute where roughly 80 events
played.

**The second render raises the carpet and lowers the peaks**, which is the one change
that can be made without touching the loudness spec: `sky` 0.16 → 0.30,
`altitude_band` 0.14 → 0.26, `ewr_departure` 0.50 → 0.29, `ewr_arrival` 0.45 → 0.26,
`overflight_city` 0.32 → 0.27, `overflight_high` 0.12 → 0.16. The spread goes from
20 dB to about 10, the median event lands level with the drone rather than under it,
and §6.8's two numbers are re-measured rather than assumed.

**What to listen for, in order:**

1. **Is there a city in it?** In A, can you hear the eighty events a minute at all, or
   only the drone and the occasional aeroplane?
2. Does B become busy or tiring — the other failure, and the one the numbers cannot
   see?
3. Does it sound like someone striking a note? Round 3 asked this of a file with four
   of the five instruments missing, so it is still open.
4. Can you tell a departure (marimba, dry) from an arrival (vibraphone, ringing)?
5. Anything harsh, and any single event that jumps out.

**Result:** _pending._
