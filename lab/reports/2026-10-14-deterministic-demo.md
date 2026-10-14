# Lab report — 2026-10-14-deterministic-demo

Rendered from `lab/renders/2026-10-14-deterministic-demo.wav` · 120.0 s · 48000 Hz

> Claude cannot hear (SPEC §7.2). Everything below is a number or an image.
> **No musical change may be adopted on these numbers alone** — §7.3 step 5
> requires a human A/B win, logged in `docs/music/listening-log.md`.

## Mix safety (SPEC §6.8)

| Measure             | Value      | Target     |
| ------------------- | ---------- | ---------- |
| Integrated loudness | -28.5 LUFS | ≈ −20 LUFS |
| Loudness range      | 1.5 LU     | —          |
| True peak           | -2.2 dBTP  | ≤ −1 dBTP  |

Loudness verdict: -28.5 LUFS — OUTSIDE target -22…-18 LUFS

## Density (SPEC §6.5)

- Onsets heard: **4** → **2.0 per minute**
- Target band: night 2–6, day 6–14 per minute
- Per-minute series: [2.0, 2.0]

## Harmony and monotony (SPEC §6.2, §6.7)

- Dominant pitch class: **D**
- Pitch-class entropy: **0.453** of 3.585 bits
  (low means the piece is stuck on a few notes)
- Histogram: {'C': 0.0004, 'C#': 0.0025, 'D': 0.9449, 'D#': 0.0068, 'E': 0.0094, 'F': 0.008, 'F#': 0.0048, 'G': 0.02, 'G#': 0.0017, 'A': 0.0003, 'A#': 0.0004, 'B': 0.0007}
- Repetition score: **0.9878** (1.0 = repeating itself, 0 = always moving)

## Spectrogram

![spectrogram](2026-10-14-deterministic-demo.png)

Look for: sustained energy above ~6 kHz (§6.8 forbids it), a static band pattern repeating at a fixed period (loop fatigue), and dead silence.

## What a human still has to decide

These numbers cannot tell you whether it is _pleasant_. Render an A and a B from the same recording and the same seed, play both to the panel, and log the result (§7.3 step 5).
