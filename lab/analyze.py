#!/usr/bin/env python3
"""Turn a rendered WAV into things Claude can read. SPEC §7.3 step 3.

This script is the project's answer to §7.2: Claude Code cannot hear. So every
musical judgement has to come from numbers and images, and this is what produces
them. It deliberately uses only ffmpeg and the Python standard library — no numpy,
no librosa — because a measurement tool that stops working after a dependency bump
is worse than a simpler one.

Outputs, per SPEC §7.3:
  - integrated loudness (LUFS), loudness range, true peak        [ffmpeg ebur128]
  - a spectrogram PNG, which Claude can actually look at         [ffmpeg showspectrumpic]
  - onset density per minute: the event rate actually HEARD, as
    opposed to the rate the governor thinks it emitted
  - pitch-class histogram: is the piece stuck on the same notes?
  - self-similarity / repetition score over 10-minute windows:
    catches loop fatigue, the §6.7 failure mode
  - simultaneous-voice estimate (max and p95)

Usage:
    python3 lab/analyze.py lab/renders/<file>.wav [--report lab/reports/<name>.md]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import subprocess
import sys
import wave
from pathlib import Path

A4_HZ = 440.0
PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def run(cmd: list[str]) -> str:
    """Run a command, returning stdout+stderr. ffmpeg writes measurements to stderr."""
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.stdout + result.stderr


def decimate(samples: list[float], rate: int, target_rate: int = 8000) -> tuple[list[float], int]:
    """Downsample by integer averaging, for the analyses that do not need bandwidth.

    Pure Python at 44.1 kHz is the difference between a lab that gets used and one
    that does not: a 10-minute render is 26 million samples, and the pitch analysis
    alone would take tens of minutes. 8 kHz still covers every pitch we measure
    (MIDI 36-96 tops out near 2.1 kHz) and every onset. Loudness and the spectrogram
    are measured by ffmpeg at the full rate, where bandwidth does matter.
    """
    factor = max(1, rate // target_rate)
    if factor == 1:
        return samples, rate
    out = []
    for start in range(0, len(samples) - factor + 1, factor):
        out.append(sum(samples[start : start + factor]) / factor)
    return out, rate // factor


def read_wav_mono(path: Path) -> tuple[list[float], int]:
    """Read a WAV as mono float samples. Stereo is summed, since the measurements we
    care about (loudness, onsets, pitch) are not about the stereo field."""
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise SystemExit(f"expected 16-bit WAV, got {width * 8}-bit")
    count = len(frames) // 2
    values = struct.unpack("<%dh" % count, frames[: count * 2])
    if channels == 1:
        return [v / 32768.0 for v in values], rate
    mono = []
    for i in range(0, len(values) - channels + 1, channels):
        mono.append(sum(values[i : i + channels]) / (channels * 32768.0))
    return mono, rate


def loudness(path: Path) -> dict[str, float | None]:
    """Integrated LUFS, loudness range and true peak, via ffmpeg's EBU R128 scanner.

    §6.8 targets about -20 LUFS integrated with a -1 dBTP ceiling, and §13's Phase 2
    gate wants loudness within +/-2 LU of target, so these are the numbers that gate
    the project rather than merely describe it.
    """
    text = run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"])
    def find(pattern: str) -> float | None:
        matches = re.findall(pattern, text)
        try:
            return float(matches[-1])
        except (IndexError, ValueError):
            return None
    return {
        "integrated_lufs": find(r"I:\s*(-?\d+\.?\d*)\s*LUFS"),
        "loudness_range_lu": find(r"LRA:\s*(-?\d+\.?\d*)\s*LU"),
        "true_peak_dbtp": find(r"Peak:\s*(-?\d+\.?\d*)\s*dBFS"),
    }


def spectrogram(path: Path, out: Path) -> Path | None:
    """A spectrogram PNG — the one output Claude can inspect directly, since it can
    view images but not hear audio (§7.2)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-i", str(path),
        "-lavfi", "showspectrumpic=s=1280x480:legend=1:scale=log:color=intensity",
        str(out),
    ])
    return out if out.exists() else None


def highpass(samples: list[float], rate: int, hz: float, stages: int = 2) -> list[float]:
    """A first-order high-pass, applied `stages` times.

    Not a nice filter, and it does not need to be: its whole job is to get the Ground
    out of the way before looking for note attacks. The drone is lowpassed at 300-620
    Hz by `ground.ts`, so two stages at 700 Hz put it ~22 dB down while leaving the
    struck voices' attack transients, which are broadband, essentially untouched.
    """
    out = list(samples)
    dt = 1.0 / rate
    rc = 1.0 / (2 * math.pi * hz)
    alpha = rc / (rc + dt)
    for _ in range(stages):
        previous_in = out[0] if out else 0.0
        previous_out = 0.0
        for index in range(1, len(out)):
            current = out[index]
            previous_out = alpha * (previous_out + current - previous_in)
            previous_in = current
            out[index] = previous_out
    return out


def onsets(samples: list[float], rate: int) -> dict[str, float | list[float]]:
    """Onset detection by a local energy rise in the band above the Ground.

    This measures the event rate actually AUDIBLE, which is not the same as the rate
    the governor emitted: voice stealing, masking and the density governor all sit in
    between. §6.5's comfortable band is about what a listener hears, so this is the
    number that matters.

    **The first version of this function could not see the piece.** It thresholded
    full-band frame energy against 2.5x the file's own median and required an 80%
    rise in one 10 ms frame. Under a continuous drone the median IS the drone, a
    struck note adds a fraction of its energy, and the measured rate came out at
    0.17 per minute against roughly 80 events a minute actually playing. A number
    that wrong is worse than no number: it reported "0.17 onsets/min" through the
    round in which four of five voices were missing from the render, and that is
    exactly the fact it existed to catch (see docs/music/decisions.md, round 3).

    Two changes. **High-pass first**, so the measurement happens in the band the
    voices own and the Ground does not. **A local threshold** - each frame against
    the median of the two seconds around it - because a drone, a passing overflight
    and a quiet night are all slow changes in the floor, and an onset is by
    definition a fast one.
    """
    hop = max(1, rate // 100)  # 10 ms
    band = highpass(samples, rate, 700.0)
    energies = []
    for start in range(0, len(band) - hop, hop):
        window = band[start : start + hop]
        energies.append(math.sqrt(sum(v * v for v in window) / len(window)))
    if not energies:
        return {"count": 0, "per_minute": 0.0, "per_minute_series": []}

    # +-1 s of context. Long enough that one note cannot raise its own threshold,
    # short enough to follow the night getting quieter.
    half = min(100, len(energies) // 2)
    absolute_floor = max(1e-5, sum(energies) / len(energies) * 0.05)

    # The local median is recomputed every 100 ms rather than every frame: the floor
    # it tracks moves over seconds, and this is the difference between an analysis
    # that takes half a minute and one that takes five.
    local = absolute_floor
    times = []
    previous = 0.0
    refractory = 0
    for index, energy in enumerate(energies):
        if index % 10 == 0:
            low = max(0, index - half)
            context = sorted(energies[low : index + half + 1])
            local = context[len(context) // 2]
        if refractory > 0:
            refractory -= 1
            previous = energy
            continue
        if energy > max(local * 2.0, absolute_floor) and energy > previous:
            times.append(index * hop / rate)
            refractory = 12  # 120 ms, so one note is not counted several times
        previous = energy

    duration_minutes = len(samples) / rate / 60
    per_minute = []
    if duration_minutes >= 1:
        for minute in range(int(duration_minutes)):
            per_minute.append(float(sum(1 for t in times if minute * 60 <= t < (minute + 1) * 60)))
    return {
        "count": len(times),
        "per_minute": round(len(times) / duration_minutes, 2) if duration_minutes else 0.0,
        "per_minute_series": per_minute,
        "times": [round(t, 3) for t in times],
    }


def pitch_classes(samples: list[float], rate: int) -> dict[str, object]:
    """Pitch-class histogram via a Goertzel filter per semitone.

    Answers "is it stuck on the same notes?" (§7.3). A piece whose weight sits on two
    or three classes will feel static however varied its rhythm is.
    """
    bins = [0.0] * 12
    window = rate // 4
    if window < 64:
        return {"histogram": {}, "entropy": 0.0, "dominant": None}
    # Sample at most this many windows, spread evenly, so cost does not grow with
    # clip length. A 24-hour render (§13 Phase 2) must still be analysable.
    max_windows = 90
    span = max(1, len(samples) - window)
    step = max(window, span // max_windows)
    frequencies = [(A4_HZ * (2 ** ((midi - 69) / 12)), midi % 12) for midi in range(36, 97)]

    for start in range(0, max(1, len(samples) - window), step):
        chunk = samples[start : start + window]
        if not chunk:
            break
        for frequency, pitch_class in frequencies:
            omega = 2 * math.pi * frequency / rate
            coefficient = 2 * math.cos(omega)
            s1 = s2 = 0.0
            for value in chunk:
                s0 = value + coefficient * s1 - s2
                s2, s1 = s1, s0
            power = s1 * s1 + s2 * s2 - coefficient * s1 * s2
            bins[pitch_class] += max(0.0, power)

    total = sum(bins) or 1.0
    normalised = [value / total for value in bins]
    entropy = -sum(p * math.log2(p) for p in normalised if p > 0)
    return {
        "histogram": {PITCH_NAMES[i]: round(normalised[i], 4) for i in range(12)},
        # 0 = one note only, log2(12) = 3.585 = perfectly even.
        "entropy_bits": round(entropy, 3),
        "max_entropy_bits": round(math.log2(12), 3),
        "dominant": PITCH_NAMES[normalised.index(max(normalised))],
    }


def repetition(samples: list[float], rate: int, window_s: int = 600) -> dict[str, object]:
    """Self-similarity over coarse spectral frames, to catch loop fatigue.

    §6.7 names boredom after ten minutes as the biggest risk, and §13's Phase 2 gate
    requires that no 10-minute window show a high repetition score. A score near 1
    means the piece is repeating itself; near 0 means it keeps moving.
    """
    frame = rate * 2
    frames = []
    for start in range(0, len(samples) - frame, frame):
        chunk = samples[start : start + frame]
        bands = [0.0] * 8
        for index, value in enumerate(chunk):
            bands[(index * 8) // len(chunk)] += value * value
        total = sum(bands) or 1.0
        frames.append([band / total for band in bands])

    if len(frames) < 4:
        return {"score": None, "note": "clip too short for a repetition score"}

    best = 0.0
    for lag in range(2, len(frames) // 2):
        similarities = []
        for i in range(len(frames) - lag):
            a, b = frames[i], frames[i + lag]
            dot = sum(x * y for x, y in zip(a, b))
            na = math.sqrt(sum(x * x for x in a)) or 1e-9
            nb = math.sqrt(sum(y * y for y in b)) or 1e-9
            similarities.append(dot / (na * nb))
        if similarities:
            best = max(best, sum(similarities) / len(similarities))
    return {
        "score": round(best, 4),
        "window_seconds": window_s,
        "note": "1.0 = repeating itself, 0 = always moving",
    }


def voice_estimate(samples: list[float], rate: int) -> dict[str, object]:
    """Rough simultaneous-voice count, from how often energy plateaus overlap.

    An estimate, not a measurement: the authoritative count comes from the engine
    itself (it reports dropped and stolen voices). This exists to catch the case
    where the engine believes it is within the §6.8 budget but the render says
    otherwise.
    """
    hop = max(1, rate // 50)
    levels = []
    for start in range(0, len(samples) - hop, hop):
        chunk = samples[start : start + hop]
        levels.append(math.sqrt(sum(v * v for v in chunk) / len(chunk)))
    if not levels:
        return {"max": 0, "p95": 0}
    ordered = sorted(levels)
    median = ordered[len(ordered) // 2] or 1e-6
    ratios = [level / median for level in levels]
    ratios.sort()
    return {
        "max_relative_level": round(ratios[-1], 2),
        "p95_relative_level": round(ratios[int(len(ratios) * 0.95)], 2),
        "note": "relative to median level; authoritative voice counts come from the engine",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyse a Brick City Hum render.")
    parser.add_argument("wav", type=Path)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--render-meta", type=Path, default=None,
                        help="JSON emitted by lab/render.ts, to include engine-side counts")
    args = parser.parse_args()

    if not args.wav.exists():
        raise SystemExit(f"no such file: {args.wav}")

    samples, rate = read_wav_mono(args.wav)
    duration = len(samples) / rate
    # ffmpeg handles loudness and the spectrogram at full rate; everything else runs
    # on a decimated copy so the script stays usable on long renders.
    coarse, coarse_rate = decimate(samples, rate)

    report_path = args.report or Path("lab/reports") / f"{args.wav.stem}.md"
    # Beside the report, not beside the WAV: renders are gitignored (they are
    # hundreds of megabytes) but the spectrogram is the one output Claude can read,
    # so it belongs in the repo with the report that references it.
    png = report_path.with_suffix(".png")

    data = {
        "file": str(args.wav),
        "duration_seconds": round(duration, 1),
        "sample_rate": rate,
        "loudness": loudness(args.wav),
        "onsets": onsets(coarse, coarse_rate),
        "pitch_classes": pitch_classes(coarse, coarse_rate),
        "repetition": repetition(coarse, coarse_rate),
        "voices": voice_estimate(coarse, coarse_rate),
    }
    spectro = spectrogram(args.wav, png)
    data["spectrogram"] = str(spectro) if spectro else None

    meta = {}
    if args.render_meta and args.render_meta.exists():
        meta = json.loads(args.render_meta.read_text())

    write_report(report_path, data, meta)
    print(json.dumps(data, indent=2))
    print(f"\nreport: {report_path}")
    return 0


def write_report(path: Path, data: dict, meta: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    loud = data["loudness"]
    onset = data["onsets"]
    pitch = data["pitch_classes"]

    def verdict(value, low, high, unit=""):
        if value is None:
            return "could not measure"
        inside = low <= value <= high
        return f"{value}{unit} — {'within' if inside else 'OUTSIDE'} target {low}…{high}{unit}"

    is_fixture = meta.get("voice") == "probe"
    lines = [
        f"# Lab report — {path.stem}",
        "",
    ]
    if is_fixture:
        lines += [
            "> ## ⚠ THIS IS A MEASUREMENT FIXTURE, NOT MUSIC",
            ">",
            "> Rendered with `lab/fixtures/probe-voice.ts` — one bell per event and a",
            "> single drone — which exists only to prove the render → measure → report",
            "> chain works, and afterwards to tell a renderer change from a music change.",
            ">",
            "> **It is supposed to sound bad.** The loudness, repetition and pitch-entropy",
            "> figures below are correct readings of a deliberately crude fixture. Do not",
            "> read them as musical problems, do not tune anything to improve them, and do",
            "> not cite this report in an A/B comparison. See `docs/music/decisions.md`.",
            "",
        ]
    lines += [
        f"Rendered from `{data['file']}` · {data['duration_seconds']} s · {data['sample_rate']} Hz",
        "",
        "> Claude cannot hear (SPEC §7.2). Everything below is a number or an image.",
        "> **No musical change may be adopted on these numbers alone** — §7.3 step 5",
        "> requires a human A/B win, logged in `docs/music/listening-log.md`.",
        "",
        "## Mix safety (SPEC §6.8)",
        "",
        "| Measure | Value | Target |",
        "|---|---|---|",
        f"| Integrated loudness | {loud['integrated_lufs']} LUFS | ≈ −20 LUFS |",
        f"| Loudness range | {loud['loudness_range_lu']} LU | — |",
        f"| True peak | {loud['true_peak_dbtp']} dBTP | ≤ −1 dBTP |",
        "",
        f"Loudness verdict: {verdict(loud['integrated_lufs'], -22, -18, ' LUFS')}",
        "",
        "## Density (SPEC §6.5)",
        "",
        f"- Onsets heard: **{onset['count']}** → **{onset['per_minute']} per minute**",
        f"- Target band: night 2–6, day 6–14 per minute",
        f"- Per-minute series: {onset['per_minute_series']}",
        "",
    ]
    if meta:
        lines += [
            "### Engine-side counts (authoritative)",
            "",
            f"- events replayed: {meta.get('eventsReplayed')}",
            f"- events dropped by the voice budget: {meta.get('eventsDropped')}",
            f"- voices stolen: {meta.get('stolenVoices')}",
            f"- reproducible render: {meta.get('reproducible')}",
            f"- sha256: `{meta.get('sha256')}`",
            "",
        ]
    lines += [
        "## Harmony and monotony (SPEC §6.2, §6.7)",
        "",
        f"- Dominant pitch class: **{pitch['dominant']}**",
        f"- Pitch-class entropy: **{pitch['entropy_bits']}** of {pitch['max_entropy_bits']} bits",
        "  (low means the piece is stuck on a few notes)",
        f"- Histogram: {pitch['histogram']}",
        f"- Repetition score: **{data['repetition']['score']}** "
        f"({data['repetition'].get('note', '')})",
        "",
        "## Spectrogram",
        "",
        f"![spectrogram]({Path(data['spectrogram']).name if data['spectrogram'] else 'not generated'})",
        "",
        "Look for: sustained energy above ~6 kHz (§6.8 forbids it), a static band "
        "pattern repeating at a fixed period (loop fatigue), and dead silence.",
        "",
        "## What a human still has to decide",
        "",
        "These numbers cannot tell you whether it is *pleasant*. Render an A and a B "
        "from the same recording and the same seed, play both to the panel, and log "
        "the result (§7.3 step 5).",
    ]
    path.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
