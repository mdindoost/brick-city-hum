# Listening log

Human listening sessions and blind A/B results. The panel rates each render 1–5 on
_pleasant_, _alive_, _annoying_, _would leave it on_ (SPEC §7.3 step 5). Only changes
that win are adopted.

| Date       | Render A                              | Render B                              | Listeners | Pleasant | Alive | Annoying | Leave it on | Winner    | Notes                                                                              |
| ---------- | ------------------------------------- | ------------------------------------- | --------- | -------- | ----- | -------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| 2026-10-14 | `aircraft-with-reverb-ground-forward` | `aircraft-with-reverb-voices-forward` | _pending_ |          |       |          |             | _pending_ | First round. One variable: how far forward the city voices sit against the Ground. |
| 2026-10-15 | `v4-all-5` (the poll rhythm)          | `v4-spread` (spread in time)          | 1         |          |       |          |             | **B**     | "B, more alive." One variable: when the events play. Adopted.                      |

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

### Round 4 — 2026-10-15 — the city arrived in chords, and now it does not

`v4-all-5` and `v4-spread`. Same six minutes, same five instruments, same levels. The
only difference is **when** the events play.

**What was found while re-rendering round 3.** The slice holds 684 events, about 114 a
minute — the rate the last two rounds asked for. They arrive in **25 batches**: one
poll of the ADS-B feed is one batch, every event in it shares one `play_at`, and the
median gap between batches is 11.3 seconds. One batch held 161 events. So what a
listener heard was sixteen notes inside a tenth of a second, then eleven seconds of
drone, twenty-five times over — chaotic and then silent, which is both halves of §1.4
in one piece.

That is a better explanation of round 2's verdict — _"there are far too few events"_ —
than the one acted on at the time. The events were there. They were all at the same
instant, and two rounds went to timbre and level while the rhythm was a pulse.

After spreading: the server releases at most three events per 250 ms tick, and the
median gap between releases is 0.25 s instead of 0.04 s followed by eleven seconds of
nothing. Measured on the live WebSocket at real speed, the demo server now sends a
median of one event per message, one second apart, where it used to send nine at once
every eleven seconds.

**What that is in audible terms**, which is the honest number and not the one first
written here: the client quantises every gesture onto 0.5 beats — 455 ms at 66 BPM —
so events inside one grid step are heard together. Counted exactly from the schedule,
the 586 events that fit inside the six minutes land on **74 instants in A and 320 in
B**: 12 a minute against 53. The biggest single instant goes from 41 notes to six, and
six only at 22 of those 320 points. "At most three at once" was the server's tick
ceiling, not what an ear gets; reconciling the tick with the grid is a separate,
musical choice.

**One hole it cannot fill.** This slice has a genuine 41-second gap where the feed
returned nothing. The spreader can only place events that exist; filling real silence
is §6.6's memory fill, which is not built. Both files have it.

**The levels, for the record** — computed from the recording and the score, no render
needed, since every event's peak is `voice.gain × distance × (0.4 + 0.6 × salience) ×
tier`:

| voice             | events | median peak | loudest |
| ----------------- | ------ | ----------- | ------- |
| `sky`             | 611    | −24.8 dBFS  | −15.0   |
| `altitude_band`   | 62     | −26.5       | −17.6   |
| `ewr_arrival`     | 5      | −5.4        | −5.2    |
| `ewr_departure`   | 3      | −5.5        | −5.3    |
| `overflight_city` | 2      | −8.4        | −8.4    |

The Ground measures −22.6 LUFS, about −19 dBFS peak, so the median event peaks about
6 dB **below** the drone while the named events sit 20 dB above the carpet. That is a
second finding and a separate round: raising the carpet and lowering the peaks is one
change, and this round is about time. Nothing about the levels was touched.

**The numbers, both files, same six minutes:**

|                     | A — `v4-all-5` (as it is) | B — `v4-spread`     |
| ------------------- | ------------------------- | ------------------- |
| events played       | 603                       | **617**             |
| events dropped      | 14                        | **0**               |
| voices stolen       | 115                       | **0**               |
| integrated          | −20.7 LUFS                | −20.7 LUFS          |
| true peak           | −1.5 dBFS                 | **−2.7**            |
| audible instants    | 74 (12.3 /min)            | **320 (53.3 /min)** |
| pitch-class entropy | 1.488 bits                | **1.534**           |
| repetition          | 0.982                     | 0.987               |

A note on the two numbers this table no longer carries: the lab's onset density is
gone, because three versions of that detector were wrong and the best rule scored F1
0.45 against a render's own schedule. The exact instant count above replaces it. See
`docs/decisions.md`.

**Zero dropped and zero stolen is the finding inside the finding.** The clumps were
what exhausted the 40-voice budget: forty notes inside one tenth of a second is the
cap, so the engine was refusing events and cutting others' slots short _because_ of
the rhythm. Spread out, the same city fits inside the budget with room to spare and
every event it made is heard. The peak drops 1.2 dB for the same loudness, for the
same reason.

Repetition rose slightly, which is the known limit of that measure: an even texture is
more self-similar than a pulse, and §1.4 wants the even one.

**What to listen for, in order:**

1. **Is it a stream or a pulse?** In A, can you hear the clumps — a handful of notes
   together, then nothing? In B, does the city become continuous?
2. Does B turn into a wash or get tiring? That is the other failure and the numbers
   cannot see it.
3. Does it sound like someone striking a note? Round 3 asked this of a file with four
   of the five instruments missing, so it is still open.
4. Can you tell a departure (marimba, dry) from an arrival (vibraphone, ringing)?
5. Anything harsh, and any single event that jumps out of the mix.

**Result: B wins.** Mohammad's verdict, 2026-10-15: _"من ب رو بیشتر پسندیدم زنده تر بودش"_
— B, more alive. First round in four that produced a winner rather than a rejection,
and the change it chose was time, not timbre: the same notes at the same levels, dealt
out one at a time instead of sixteen at once. `spread` stays on by default.

**What it did not settle**, because it was not the variable: whether the piece sounds
like someone striking a note. His next observation went straight past the voices to
the bed — _"I think that background noise is there because you are synthesising it"_ —
which is round 5.

### Round 5 — 2026-10-15 — the bed, which nobody had touched

`v5-osc` and `v5-cello`. Same events, same voices, same spread, same loudness. The
only difference is what the bed is made of.

**The hypothesis is Mohammad's**, straight after round 4: _"I think that background
noise is there because you are synthesising it."_ Four rounds had gone to the voices
while the one layer nobody had changed was the loudest and most continuous thing in
the piece — three triangle oscillators at 73 and 110 Hz behind a 420 Hz lowpass.
A filtered triangle that low is not a drone, it is the sound of a transformer, and
nothing in it was ever bowed, blown or struck.

_Music for Airports_, which §6.7.1 cites for the loop technique, is tape loops of
recorded voices and piano. The oscillators were never the faithful reading.

**B is a cello section**, bowed, from VSCO 2 CE (CC0, §6.9), built the way those tapes
were: one recording per note, re-entered before the last entry has gone, so the sound
is continuous and has no loop point. Three things had to be measured rather than
guessed, and each one was visible on a bed-only spectrogram:

1. A linear crossfade drops two uncorrelated copies by 3 dB where they meet — a dark
   stripe every ten seconds, §6.7.1's pulse arriving through the back door. Equal
   power fixes it.
2. The solo contrabass tried first was not sustained at all: its "SusNV" takes are
   two or three separate bow strokes with silence between them.
3. Without rotating the entry's start point, the bed is one five-second phrase
   repeating. The offset now walks by the golden ratio — fixed, so every listener
   hears the same bed (§5).

| bed alone, two minutes | A — oscillators | B — cello section |
| ---------------------- | --------------- | ----------------- |
| integrated             | −21.7 LUFS      | −21.6 LUFS        |
| below 200 Hz           | −22.0           | −25.7             |
| above 300 Hz           | −38.5           | **−26.1**         |

Level-matched on purpose, or the round would be a test of loudness. The two numbers
that differ are the point: B has less weight at the bottom and **12 dB more above
300 Hz**, which is the bow — and also the half of the spectrum the harp and vibraphone
live in. Whether that reads as an instrument or as something covering the city is
exactly the question.

**What to listen for, in order:**

1. **Is it still background noise?** That is the whole round, and it is your own test.
2. Does the bed cover the city? In A the band above 300 Hz was empty and the events
   had it to themselves.
3. Does the bed repeat? If you can hear a phrase coming back, `rotate_s` is too small
   and that is a number, not a rebuild.
4. Does it want more weight at the bottom? A quiet sine under it is one line of
   config, but it is synthesis, so it goes to your ears first.

**Result:** _pending._
