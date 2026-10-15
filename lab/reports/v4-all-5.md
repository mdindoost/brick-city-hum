# Lab report — v4-all-5

Rendered from `lab/renders/2026-10-15-aircraft-with-reverb-v4-all-5.wav` · 360.0 s · 48000 Hz

> Claude cannot hear (SPEC §7.2). Everything below is a number or an image.
> **No musical change may be adopted on these numbers alone** — §7.3 step 5
> requires a human A/B win, logged in `docs/music/listening-log.md`.

## Mix safety (SPEC §6.8)

| Measure | Value | Target |
|---|---|---|
| Integrated loudness | -20.7 LUFS | ≈ −20 LUFS |
| Loudness range | 5.9 LU | — |
| True peak | -1.5 dBTP | ≤ −1 dBTP |

Loudness verdict: -20.7 LUFS — within target -22…-18 LUFS

## Density (SPEC §6.5)

- Onsets heard: **2154** → **359.0 per minute**
- Target band: night 2–6, day 6–14 per minute
- Per-minute series: [378.0, 366.0, 352.0, 338.0, 372.0, 348.0]

## Harmony and monotony (SPEC §6.2, §6.7)

- Dominant pitch class: **D**
- Pitch-class entropy: **1.488** of 3.585 bits
  (low means the piece is stuck on a few notes)
- Histogram: {'C': 0.0009, 'C#': 0.001, 'D': 0.5005, 'D#': 0.0037, 'E': 0.0163, 'F': 0.0043, 'F#': 0.0041, 'G': 0.0005, 'G#': 0.018, 'A': 0.4287, 'A#': 0.0136, 'B': 0.0082}
- Repetition score: **0.9822** (1.0 = repeating itself, 0 = always moving)

## Spectrogram

![spectrogram](v4-all-5.png)

Look for: sustained energy above ~6 kHz (§6.8 forbids it), a static band pattern repeating at a fixed period (loop fatigue), and dead silence.

## What a human still has to decide

These numbers cannot tell you whether it is *pleasant*. Render an A and a B from the same recording and the same seed, play both to the panel, and log the result (§7.3 step 5).
