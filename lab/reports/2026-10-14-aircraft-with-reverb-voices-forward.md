# Lab report — 2026-10-14-aircraft-with-reverb-voices-forward

Rendered from `lab/renders/2026-10-14-aircraft-with-reverb-voices-forward.wav` · 600.0 s · 48000 Hz

> Claude cannot hear (SPEC §7.2). Everything below is a number or an image.
> **No musical change may be adopted on these numbers alone** — §7.3 step 5
> requires a human A/B win, logged in `docs/music/listening-log.md`.

## Mix safety (SPEC §6.8)

| Measure | Value | Target |
|---|---|---|
| Integrated loudness | -23.8 LUFS | ≈ −20 LUFS |
| Loudness range | 11.1 LU | — |
| True peak | -1.1 dBTP | ≤ −1 dBTP |

Loudness verdict: -23.8 LUFS — OUTSIDE target -22…-18 LUFS

## Density (SPEC §6.5)

- Onsets heard: **17** → **1.7 per minute**
- Target band: night 2–6, day 6–14 per minute
- Per-minute series: [1.0, 3.0, 0.0, 4.0, 0.0, 1.0, 4.0, 0.0, 3.0, 1.0]

## Harmony and monotony (SPEC §6.2, §6.7)

- Dominant pitch class: **D**
- Pitch-class entropy: **1.476** of 3.585 bits
  (low means the piece is stuck on a few notes)
- Histogram: {'C': 0.001, 'C#': 0.0011, 'D': 0.467, 'D#': 0.0029, 'E': 0.0092, 'F': 0.0243, 'F#': 0.0027, 'G': 0.0005, 'G#': 0.0144, 'A': 0.4633, 'A#': 0.0107, 'B': 0.0028}
- Repetition score: **0.9661** (1.0 = repeating itself, 0 = always moving)

## Spectrogram

![spectrogram](2026-10-14-aircraft-with-reverb-voices-forward.png)

Look for: sustained energy above ~6 kHz (§6.8 forbids it), a static band pattern repeating at a fixed period (loop fatigue), and dead silence.

## What a human still has to decide

These numbers cannot tell you whether it is *pleasant*. Render an A and a B from the same recording and the same seed, play both to the panel, and log the result (§7.3 step 5).
