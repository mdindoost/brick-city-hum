# Lab report — 2026-10-14-aircraft-with-reverb-dense-major

Rendered from `lab/renders/2026-10-14-aircraft-with-reverb-dense-major.wav` · 600.0 s · 48000 Hz

> Claude cannot hear (SPEC §7.2). Everything below is a number or an image.
> **No musical change may be adopted on these numbers alone** — §7.3 step 5
> requires a human A/B win, logged in `docs/music/listening-log.md`.

## Mix safety (SPEC §6.8)

| Measure | Value | Target |
|---|---|---|
| Integrated loudness | -19.7 LUFS | ≈ −20 LUFS |
| Loudness range | 6.2 LU | — |
| True peak | -1.1 dBTP | ≤ −1 dBTP |

Loudness verdict: -19.7 LUFS — within target -22…-18 LUFS

## Density (SPEC §6.5)

- Onsets heard: **7** → **0.7 per minute**
- Target band: night 2–6, day 6–14 per minute
- Per-minute series: [0.0, 0.0, 0.0, 3.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0]

## Harmony and monotony (SPEC §6.2, §6.7)

- Dominant pitch class: **D**
- Pitch-class entropy: **1.451** of 3.585 bits
  (low means the piece is stuck on a few notes)
- Histogram: {'C': 0.001, 'C#': 0.0009, 'D': 0.4707, 'D#': 0.0037, 'E': 0.0115, 'F': 0.0048, 'F#': 0.0032, 'G': 0.0004, 'G#': 0.02, 'A': 0.4652, 'A#': 0.0148, 'B': 0.0039}
- Repetition score: **0.9818** (1.0 = repeating itself, 0 = always moving)

## Spectrogram

![spectrogram](2026-10-14-aircraft-with-reverb-dense-major.png)

Look for: sustained energy above ~6 kHz (§6.8 forbids it), a static band pattern repeating at a fixed period (loop fatigue), and dead silence.

## What a human still has to decide

These numbers cannot tell you whether it is *pleasant*. Render an A and a B from the same recording and the same seed, play both to the panel, and log the result (§7.3 step 5).
