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

## 2026-10-14 · Round 1 lost, and what the spectrogram showed

Mohammad's verdict on the first pair: **both boring, far too few events, and the music
should be brighter** — then, on the live page: **"it has sound, but there is a
background noise that is not good."**

**The noise was not noise. It was clicks, and they were mine.**

The spectrogram of the first dense render shows vertical streaks of broadband energy
reaching 12 kHz at event times, in a piece whose loudest intended component dies by
2 kHz. A note is a horizontal line; a vertical line across the whole spectrum is a
step discontinuity. Every sustained voice — the overflight, the helicopter — stopped
its oscillator at the moment its envelope release nominally ended. An
`AmplitudeEnvelope` decays exponentially and never reaches zero, so each of those
stops cut a waveform mid-cycle. Oscillators now run four release constants past the
end, about 35 dB down, and the engine waits longer still before releasing the chain,
since disposing a node with signal flowing through it is the same discontinuity by
another route.

Worth recording as a general rule: **this is the kind of defect that is inaudible to
me and obvious to anyone listening.** The numbers were all fine — loudness on target,
true peak legal, repetition falling. The §7.2 constraint is not a formality.

**On density.** The sky was re-measured rather than argued about: 331 aircraft an hour
come within 46 km of campus and the original rules spoke 1.4 times a minute. Six
distance rings (30, 20, 14, 10, 7, 5 km) crossed inward give **20 a minute** from the
same aircraft, and because §6.4 already makes distance quieter, darker and wetter, a
30 km crossing is a whisper and a 5 km one is an event — one rule, not six.

That is above §6.5's 6–14 band on purpose. The band is a target for what a listener
_hears_, and the governor's job (§6.5, still to be built) is to decide which of the
20 become foreground. Giving it more to choose from is the right order of work.

**Brightness is round 2's question**, and it is one config line: the palette's scale.

## 2026-10-15 · Round 2 lost too, and the answer was recorded samples

Mohammad's verdict on round 2 was round 1's verdict again, and sharper:

> هیچکدام چون نویز بک گراند مانند دارد و حس موسیقیایی ندارد… ببین انکه من در
> ویکیپدیا شنیدم اینجوری نبود انگار کسی نت را واقعا میزد.

Neither one, because it has something like background noise and no musical feeling —
and the Wikipedia one was not like this, it was as if someone was really _striking_
the note.

So the research question became: what is Listen to Wikipedia doing that we are not?
Hatnote's piece plays **recorded samples, edited with SoX** — a bell for an addition,
a string pluck for a removal, pitch inversely proportional to edit size, a pentatonic,
a random pick among three takes. Not one oscillator anywhere. That is the whole
difference, and it is not a question of taste: the attack transient of a struck bar
or a plucked string is a broadband event lasting a few milliseconds, and it is what
the ear uses to decide that a physical object was hit by a person. A sine with a 20 ms
envelope has no transient at all, so it arrives as a tone appearing — a notification
sound, which is exactly what "no musical feeling" describes.

(No prior art exists for live ADS-B as ambient radio. The nearest neighbours are
SonAir, which sonifies radar for controllers, and AeroSonicDB, which labels recorded
aircraft audio. Neither is trying to be music.)

**So: four of the five aircraft voices now play CC0 samples.** §6.9 already permitted
this, from VCSL or VSCO 2 CE only.

| voice             | was                               | is                | why that instrument                                                                                                                                       |
| ----------------- | --------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ewr_departure`   | triangle PolySynth                | **marimba**       | dry and definite, shortest decay of the five — a rising figure needs each note to land and then clear the way                                             |
| `ewr_arrival`     | triangle PolySynth, softer attack | **vibraphone**    | rings and settles. The pair now read as opposites through their instruments rather than through 100 ms of attack time                                     |
| `overflight_city` | two detuned sines                 | **tubular bells** | the one struck sound that reads as sustained, and its partials beat against each other the way the detuned pair was imitating                             |
| `overflight_high` | sine, two octaves up              | **glockenspiel**  | already lives up there, so the octave offset became the register                                                                                          |
| `sky`             | sine                              | **concert harp**  | three or four of these per named event, so it must be the quietest and plainest thing in the set                                                          |
| `helicopter`      | triangle + tremolo                | **unchanged**     | a rotor is a flutter and no struck sample flutters. §6.4 names the tremolo rate as the identifying feature, so a sample would cost the voice its identity |

The PATH bell (FM, harmonicity 3.1) and the tap voices were already struck and are
left alone.

### Four things that had to be measured rather than assumed

**VCSL has no single pitch-naming convention.** Its idiophones put middle C at C3.
The Concert Harp uses the scientific convention — its `A2` measures a clean harmonic
series on 110 Hz, MIDI 45. Tubular Bells 1 is named _two_ octaves below what it
sounds: nine files called C3..E4 whose strongest partials form an exact whole-tone
series on MIDI 72..88, which is C5..E6, the sounding range of a real chime set. One
global offset built the harp above the top of a real harp and the chimes an octave
low, **silently** — a transposed radio still works. `tools/test-sample-pitch.py` now
decodes every committed file and fails on a kit whose median deviation is not zero.

**The softest dynamic layer is not always usable.** VCSL's soft marimba F5 peaks at
−68 dBFS. Lifting that to a usable level lifts its room tone with it, which is
precisely the complaint this whole change exists to answer. The builder walks each
note's layers from softest upward and takes the first whose mono peak clears −50 dBFS.

**Mono peak, not stereo peak.** The engine pans every event itself (§6.4), and a
downmix loses up to 6 dB on a wide recording. Measuring the stereo file under-levelled
every kit by that much — the first build's gains were all 6 dB short.

**Per-file normalisation, not per-kit.** One gain per instrument preserves its natural
loudness curve across its range, which was the first instinct. But the measured spread
_inside_ one VCSL kit is ~15 dB between neighbouring registers — marimba B4 sits 15 dB
under F3 — and that is recording variation, not the instrument. Here one event is one
note, so a 15 dB step between two altitude bands reads as a mixing fault. Every file
goes to a −3 dBFS peak, with the lift capped at 42 dB so a pathologically quiet file
cannot drag its room up with it.

### The register problem, and why it folds instead of clamping

No kit covers the two octaves the altitude mapping asks for; the chimes are nine files
across sixteen semitones. Beyond its range the nearest sample has to be bent so far it
stops sounding like the instrument — a chime pitched down a fifth is a slow, dull,
audibly-stretched chime. So each voice declares a `register` in `score.yaml`.

The first version clamped into it. That was wrong, and wrong in the project's
characteristic way: clamping maps every note below the register onto a single pitch,
so the bottom of the altitude range becomes one repeated note — the exact monotony the
sampled voices exist to escape. It folds **by octaves** instead, which keeps the scale
degree, so the note is still in the palette (§6.2's no wrong notes, ever) and the
shape of the altitude mapping survives. Only its absolute octave becomes the
instrument's choice rather than the aircraft's.

The honest cost: `heavy`'s octave drop now survives only where the register has room
for it, because a heavy note already at the bottom of a narrow register folds straight
back up. The length multiplier always survives, and on a sampled voice length is most
of what "heavy" sounds like.

### Deviation from §6.9 worth flagging

§6.9 asks for samples "lazy-loaded by palette". Every palette here uses all five kits,
so per-palette loading would load all of them anyway. They load up front instead, in
parallel, after the ▶ press — and the Ground, which is synthesis and needs nothing,
starts immediately so the page is making sound while the 3 MB arrives. A kit that
fails to load drops its voice rather than falling back to an oscillator: a fallback
would mean the piece quietly sounded like the version that lost two rounds.
