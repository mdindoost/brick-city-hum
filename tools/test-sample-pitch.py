#!/usr/bin/env python3
"""Every committed sample is the pitch its filename claims. SPEC §7.2, §6.9.

This is the one test in the project that measures audio, and it exists because of a
specific silent failure. VCSL names its pitches with **middle C at C3**, one octave
below the scientific convention; `tools/fetch-samples.py` converts with
MIDI = 12 * (octave + 2) + semitone. Get that wrong and nothing breaks — the kits
build, the page loads, every voice plays — the whole radio is simply transposed an
octave, which is exactly the class of mistake Claude cannot hear (§7.2).

So: decode each committed sample and find which MIDI note its strongest partial sits
closest to. What the test asserts is deliberately narrower than "every file is in
tune", because a single DFT peak cannot tell the fundamental of a tubular bell from
its third partial — bells are inharmonic and their strike note is often not a partial
at all. Two things it can say with confidence:

  - **the median deviation across a kit must be zero.** A naming-convention error
    transposes every file in the kit by the same amount, so the median is exactly
    where it shows and exactly where an inharmonic partial does not.
  - **no sample may measure flat by two semitones or more.** A mis-detected partial
    is always *above* the fundamental, so a downward error cannot be the detector's
    fault — the label is wrong. This is what rejected VCSL's kalimba kit, whose
    A#3 key measured three semitones flat.

Deviations of a semitone either way are printed and tolerated; they are at the limit
of what this measurement can resolve on a struck sound.

Ships with the samples, needs no network, and uses only ffmpeg and the standard
library — the same rule lab/analyze.py follows.

Usage:  python3 tools/test-sample-pitch.py [client/public/samples]
"""

from __future__ import annotations

import math
import struct
import subprocess
import sys
from pathlib import Path

SR = 44100
# A full second. A third of a second was the first guess and it mis-read one chime by
# four semitones: a bell's partials take time to settle into their steady ratios, and
# a short window weights the strike noise heavily enough to move the winner.
WINDOW_S = 1.0
# Skip the attack: the strike itself is broadband and its partials are not yet settled.
SKIP_S = 0.04


def decode(path: Path) -> list[int]:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR),
         "-ss", str(SKIP_S), "-t", str(WINDOW_S), "-f", "s16le", "-"],
        capture_output=True, check=True).stdout
    count = len(raw) // 2
    return list(struct.unpack(f"<{count}h", raw[: count * 2]))


def goertzel(samples: list[int], hz: float) -> float:
    """Magnitude at one frequency — a single DFT bin, without needing numpy."""
    angle = 2 * math.pi * hz / SR
    coefficient = 2 * math.cos(angle)
    first = second = 0.0
    for value in samples:
        current = value + coefficient * first - second
        second, first = first, current
    return math.hypot(first - second * math.cos(angle), second * math.sin(angle))


def hz_of(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def strongest(samples: list[int], low: int, high: int) -> int:
    return max(range(low, high + 1), key=lambda midi: goertzel(samples, hz_of(midi)))


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "client/public/samples")
    files = sorted(root.glob("*/*.m4a"))
    if not files:
        print(f"no samples under {root}", file=sys.stderr)
        return 1

    failures: list[str] = []
    notes: list[str] = []
    by_kit: dict[str, list[int]] = {}

    for path in files:
        claimed = int(path.stem)
        samples = decode(path)
        if not samples:
            failures.append(f"{path.parent.name}/{path.name}: decoded to nothing")
            continue
        # Search a fifth below and an octave-and-a-fifth above: wider than any naming
        # slip, and wide enough to find the partial a bell actually puts its energy in.
        found = strongest(samples, max(24, claimed - 7), min(126, claimed + 19))
        deviation = found - claimed
        by_kit.setdefault(path.parent.name, []).append(deviation)
        if deviation <= -2:
            failures.append(
                f"{path.parent.name}/{path.name}: claims MIDI {claimed} "
                f"({hz_of(claimed):.1f} Hz) but measures {deviation} semitones flat, at "
                f"{found} ({hz_of(found):.1f} Hz). A mis-read partial is never flat, so "
                f"the label is wrong.")
        elif deviation != 0:
            notes.append(f"{path.parent.name}/{path.name}: {deviation:+d} semitones "
                         f"(partial at MIDI {found}) — tolerated")

    for kit, deviations in sorted(by_kit.items()):
        ordered = sorted(deviations)
        middle = len(ordered) // 2
        median = ordered[middle] if len(ordered) % 2 else (
            (ordered[middle - 1] + ordered[middle]) / 2)
        if median != 0:
            failures.append(
                f"kit {kit}: median deviation {median:+g} semitones across "
                f"{len(deviations)} samples — the whole kit is transposed, which is "
                f"what a wrong octave convention in tools/fetch-samples.py looks like.")
        print(f"{kit:14s} {len(deviations):2d} samples  median {median:+g}")

    for line in notes:
        print(f"note {line}")
    for line in failures:
        print(f"FAIL {line}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
