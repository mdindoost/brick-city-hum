# Lab report — v3-forward-5

Rendered from `lab/renders/2026-10-15-aircraft-with-reverb-v3-forward-5.wav` · 360.0 s · 48000 Hz

> Claude cannot hear (SPEC §7.2). Everything below is a number or an image.
> **No musical change may be adopted on these numbers alone** — §7.3 step 5
> requires a human A/B win, logged in `docs/music/listening-log.md`.

## Mix safety (SPEC §6.8)

| Measure | Value | Target |
|---|---|---|
| Integrated loudness | -21.4 LUFS | ≈ −20 LUFS |
| Loudness range | 4.4 LU | — |
| True peak | -5.3 dBTP | ≤ −1 dBTP |

Loudness verdict: -21.4 LUFS — within target -22…-18 LUFS

## Density (SPEC §6.5)

- Onsets heard: **1** → **0.17 per minute**
- Target band: night 2–6, day 6–14 per minute
- Per-minute series: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0]

## Harmony and monotony (SPEC §6.2, §6.7)

- Dominant pitch class: **A**
- Pitch-class entropy: **1.478** of 3.585 bits
  (low means the piece is stuck on a few notes)
- Histogram: {'C': 0.0011, 'C#': 0.0012, 'D': 0.4522, 'D#': 0.0037, 'E': 0.0148, 'F': 0.0048, 'F#': 0.0034, 'G': 0.0005, 'G#': 0.0202, 'A': 0.4786, 'A#': 0.0152, 'B': 0.0043}
- Repetition score: **0.9949** (1.0 = repeating itself, 0 = always moving)

## Spectrogram

![spectrogram](v3-forward-5.png)

Look for: sustained energy above ~6 kHz (§6.8 forbids it), a static band pattern repeating at a fixed period (loop fatigue), and dead silence.

## What a human still has to decide

These numbers cannot tell you whether it is *pleasant*. Render an A and a B from the same recording and the same seed, play both to the panel, and log the result (§7.3 step 5).
