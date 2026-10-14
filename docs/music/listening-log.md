# Listening log

Human listening sessions and blind A/B results. The panel rates each render 1–5 on
_pleasant_, _alive_, _annoying_, _would leave it on_ (SPEC §7.3 step 5). Only changes
that win are adopted.

| Date       | Render A                              | Render B                              | Listeners | Pleasant | Alive | Annoying | Leave it on | Winner    | Notes                                                                              |
| ---------- | ------------------------------------- | ------------------------------------- | --------- | -------- | ----- | -------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| 2026-10-14 | `aircraft-with-reverb-ground-forward` | `aircraft-with-reverb-voices-forward` | _pending_ |          |       |          |             | _pending_ | First round. One variable: how far forward the city voices sit against the Ground. |

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

_Phase 1 gate (§13): median "would leave it on" ≥ 3.5/5 across 10–20 testers._
