#!/usr/bin/env python3
"""Build the CC0 sample kits in client/public/samples/. SPEC §6.9, §12.

Why a script and not a one-off: the samples are committed, but *how* they were made
has to be reproducible and auditable. Anyone can re-run this and get the same kits,
and the provenance of every file — which VCSL path it came from, which dynamic layer,
how much gain — is in the source and in the printed report rather than in someone's
memory.

Only VCSL (CC0) is touched. **VCSL does not use one pitch-naming convention.** Its
idiophones put middle C at C3, so MIDI = 12 * (octave + 2) + semitone: the
glockenspiel's `C5` is MIDI 84 and the vibraphone's `C3` is middle C, both measured.
The Concert Harp uses the scientific convention instead — its `A2` measures a clean
harmonic series on 110 Hz, i.e. MIDI 45, and reading it the idiophones' way would
have put the kit an octave above the top of a real harp. So the offset is per kit,
and `tools/test-sample-pitch.py` measures every committed file and fails on a kit
whose median deviation is not zero. That test is what found this; the first version
of this script had one global offset and silently built the harp an octave high.

**The softest layer is not always usable.** VCSL is a community library and its
dynamic layers were not levelled: the marimba's soft F5 peaks at −68 dBFS, which is
quiet enough that lifting it to a usable level would lift its room tone into the mix
as well — precisely the "sounds like background noise" failure this whole change
exists to fix. So the script walks each note's dynamic layers from softest upwards
and takes the first one whose **mono** peak clears a floor. Mono, because the engine
pans every event itself (§6.4) and a stereo sample both fights the panner and loses
up to 6 dB of peak in the downmix — measuring the stereo file was the first version's
bug, and it under-levelled every kit.

The rest of the conversion:
  - **leading silence trimmed after the gain is applied**, so the threshold is
    relative to the note rather than to whatever level VCSL happened to record at.
  - **length capped per kit** with a 250 ms fade, because a bell that rings for ten
    seconds holds a voice slot for ten seconds (§6.8's budget) and its tail below
    −40 dB is inaudible under the Ground anyway.
  - **AAC at 128 kbps**, which every target browser decodes natively. Higher than an
    ambient piece needs, because the attack transient of a struck sound is the entire
    point of this change and that is what a low bit rate smears first.

Usage:  python3 tools/fetch-samples.py [--out client/public/samples] [--kit marimba]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/sgossner/VCSL/master"
API = "https://api.github.com/repos/sgossner/VCSL/contents"
SEMITONE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
            "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}

# Per-kit, because VCSL is not consistent. See the module docstring.
OCTAVE_MIDDLE_C3 = 2   # most idiophones: C3 is middle C
OCTAVE_SCIENTIFIC = 1  # the Concert Harp: C4 is middle C
# Tubular Bells 1 is a third case. Its nine files are named C3..E4 and they sound a
# clean whole-tone series on MIDI 72..88 — measured one by one, the strongest partial
# of each file, with no exception. That is C5..E6, the sounding range of a real
# orchestral chime set, so the files are named two octaves below what they sound.
OCTAVE_CHIMES = 3

# Every sample is brought to this peak, so one altitude band is never louder than its
# neighbour for a reason that has nothing to do with the city.
TARGET_PEAK_DB = -3.0
# A mono peak below this means the recording is too quiet to lift without lifting the
# room with it; the script moves to the next dynamic layer instead.
USABLE_PEAK_DB = -50.0
# Hard ceiling on the lift, as a guard rather than a tuning value.
MAX_BOOST_DB = 42.0


def midi_of(name: str, octave_offset: int) -> int:
    match = re.fullmatch(r"([A-G]#?)(-?\d)", name)
    if match is None:
        raise ValueError(f"not a pitch name: {name}")
    return 12 * (int(match.group(2)) + octave_offset) + SEMITONE[match.group(1)]


class Kit:
    """One instrument: where it lives, how its files are named, what to take."""

    def __init__(self, name: str, folder: str, filename: str,
                 layers: list[str], notes: list[str], max_s: float, used_for: str,
                 instrument: str, octave_offset: int = OCTAVE_MIDDLE_C3) -> None:
        self.name = name
        self.instrument = instrument
        self.octave_offset = octave_offset
        self.folder = folder
        self.filename = filename        # a regex with {note} and {layer}
        self.layers = layers            # softest first
        self.notes = notes
        self.max_s = max_s
        self.used_for = used_for

    def pattern(self, note: str, layer: str) -> re.Pattern[str]:
        body = self.filename.format(note=re.escape(note), layer=re.escape(layer))
        return re.compile(body)


# The kits, and what each one is for. Soft dynamic layers first throughout: §6.8
# forbids sudden loud transients, and the soft layer of a mallet instrument is both
# quieter and gentler in attack than a gain reduction of the loud one.
KITS = [
    Kit("marimba", "Idiophones/Struck Idiophones/Marimba",
        r"Marimba_hit_Outrigger_{note}_{layer}_\d+\.wav", ["soft", "med", "loud"],
        ["F1", "C2", "G2", "B2", "F3", "C4", "G4", "B4", "F5", "C6"], 2.5,
        "EWR departures — woody and definite; a rising figure needs each note to land",
        "Marimba, outrigger mics"),
    Kit("vibraphone", "Idiophones/Struck Idiophones/Vibraphone/Soft Mallets",
        r"Vibes_soft_{note}_{layer}_rr\d+_Main\.wav", ["v1", "v2"],
        ["F2", "A2", "C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5"], 5.0,
        "EWR arrivals — rounder, and it keeps ringing as it settles",
        "Vibraphone, soft mallets"),
    Kit("chimes", "Idiophones/Struck Idiophones/Tubular Bells 1",
        r"chimes_{note}_{layer}_rr\d+\.wav", ["pp", "p", "f", "ff", "fff"],
        ["C3", "D3", "E3", "F#3", "G#3", "A#3", "C4", "D4", "E4"], 8.0,
        "overflights across the city — the one struck sound that reads as sustained",
        "Tubular Bells 1", OCTAVE_CHIMES),
    Kit("glockenspiel", "Idiophones/Struck Idiophones/Glockenspiel",
        r"glock_{layer}_{note}_\d+\.wav", ["soft", "medium", "loud"],
        ["G4", "C5", "G5", "C6", "G6", "C7"], 4.0,
        "high overflights — barely audible shimmer, already in the right register",
        "Glockenspiel"),
    # A harp and not the obvious choice, a kalimba. VCSL has two lamellophone kits and
    # both are tuned the way a real mbira is tuned, which is to say not in equal
    # temperament: `tools/test-sample-pitch.py` measured its A#3 key sounding three
    # semitones flat and three more keys a semitone out. For any other voice that is
    # character; for this one it is fatal, because ring crossings are the most
    # frequent sound in the piece and §6.2 promises no wrong notes, ever. A harp is
    # plucked, soft, and in tune.
    Kit("harp", "Chordophones/Composite Chordophones/Concert Harp",
        r"KSHarp_{note}_{layer}\d+\.wav", ["mf", "f"],
        ["A2", "E3", "B3", "F4", "C5", "G5", "D6", "A6", "F7"], 3.0,
        "distance-ring crossings — the quietest voice in the set, three or four per named event",
        "Concert Harp", OCTAVE_SCIENTIFIC),
]

LICENSE_HEAD = """# Sample provenance and licence

Every file in this directory was produced by `tools/fetch-samples.py` from the
**Versilian Community Sample Library (VCSL)**, released by Versilian Studios under
**CC0 1.0 Universal (public domain dedication)**.

- Source: https://github.com/sgossner/VCSL
- Licence: https://creativecommons.org/publicdomain/zero/1.0/
- Licence text as shipped with VCSL: https://github.com/sgossner/VCSL/blob/master/LICENSE

CC0 waives copyright entirely: no attribution is required. This note exists anyway,
because SPEC §12 asks for zero licensing exposure, and a reader of a public
repository should be able to see at a glance where the audio came from.

Files are named by **MIDI note number** — `72.m4a` is middle C. VCSL's own pitch
names put middle C at C3; the conversion is in the script, with a test that pins it.

Nothing else may be added here. SPEC §6.9 allows samples from VCSL and VSCO 2 CE
only, both CC0; anything else is a licence this project cannot carry.

"""


def run(args: list[str]) -> str:
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {done.stderr.strip()[-600:]}")
    return done.stderr + done.stdout


def listing(folder: str) -> list[str]:
    url = f"{API}/{urllib.parse.quote(folder)}"
    request = urllib.request.Request(url, headers={"User-Agent": "brick-city-hum (sample fetch)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        entries = json.load(response)
    return sorted(e["name"] for e in entries if e["type"] == "file")


def download(folder: str, name: str, into: Path) -> Path:
    into.parent.mkdir(parents=True, exist_ok=True)
    if into.exists() and into.stat().st_size > 0:
        return into
    url = f"{RAW}/{urllib.parse.quote(folder + '/' + name)}"
    request = urllib.request.Request(url, headers={"User-Agent": "brick-city-hum (sample fetch)"})
    with urllib.request.urlopen(request, timeout=180) as response:
        into.write_bytes(response.read())
    return into


def peak_db(path: Path, filters: str = "") -> float:
    chain = f"{filters},volumedetect" if filters else "volumedetect"
    text = run(["ffmpeg", "-v", "info", "-i", str(path), "-map", "0:a",
                "-af", chain, "-f", "null", "-"])
    match = re.search(r"max_volume:\s*(-?[\d.]+) dB", text)
    if match is None:
        raise RuntimeError(f"no max_volume for {path.name}")
    return float(match.group(1))


def duration_s(path: Path) -> float:
    text = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "csv=p=0", str(path)])
    return float(text.strip())


def mono_peak_db(path: Path) -> float:
    """Peak after the downmix the client will actually hear."""
    return peak_db(path, "aformat=channel_layouts=mono")


FADE_S = 0.25


def convert(source: Path, target: Path, work: Path, max_s: float, gain_db: float) -> float:
    """Mono, lifted, head-trimmed, capped and faded. Returns the final length."""
    target.parent.mkdir(parents=True, exist_ok=True)
    work.parent.mkdir(parents=True, exist_ok=True)

    # The gain goes on before the trim so that −60 dB means "60 dB below this note"
    # rather than "60 dB below full scale, whatever VCSL recorded at".
    run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ac", "1", "-ar", "44100",
         "-t", f"{max_s:.3f}", "-af",
         f"volume={gain_db:.2f}dB,"
         # −60 dB rather than a comfortable −40: the first cycles of a struck sound
         # are quiet, and they are what makes it sound struck.
         "silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0:detection=peak",
         "-c:a", "pcm_s16le", str(work)])

    length = duration_s(work)
    fade_at = max(0.0, min(max_s, length) - FADE_S)
    run(["ffmpeg", "-v", "error", "-y", "-i", str(work), "-af",
         f"afade=t=out:st={fade_at:.3f}:d={FADE_S}",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(target)])
    return length


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="client/public/samples")
    parser.add_argument("--cache", default=None, help="where the raw VCSL WAVs are kept")
    parser.add_argument("--kit", action="append", help="build only these kits")
    args = parser.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            print(f"{tool} is required", file=sys.stderr)
            return 1

    out = Path(args.out)
    cache = Path(args.cache) if args.cache else out.parent / ".vcsl-cache"
    kits = [kit for kit in KITS if args.kit is None or kit.name in args.kit]

    manifest: dict[str, list[int]] = {}
    rows: list[str] = []
    for kit in kits:
        available = listing(kit.folder)
        chosen: dict[int, tuple[str, str, float]] = {}
        for note in kit.notes:
            for layer in kit.layers:
                pattern = kit.pattern(note, layer)
                names = [name for name in available if pattern.fullmatch(name)]
                if not names:
                    continue
                source = download(kit.folder, names[0], cache / kit.name / names[0])
                peak = mono_peak_db(source)
                if peak >= USABLE_PEAK_DB or layer == kit.layers[-1]:
                    chosen[midi_of(note, kit.octave_offset)] = (names[0], layer or "-", peak)
                    break
            else:
                print(f"  ! {kit.name} {note}: no file matched", file=sys.stderr)

        directory = out / kit.name
        # Clear the kit first. A rebuild after a note list or an octave offset changed
        # would otherwise leave the old filenames behind, and a stale sample is a wrong
        # note that nothing else in this project can detect.
        if directory.exists():
            for stale in directory.glob("*.m4a"):
                stale.unlink()
        for midi, (name, layer, peak) in sorted(chosen.items()):
            gain = min(MAX_BOOST_DB, TARGET_PEAK_DB - peak)
            length = convert(cache / kit.name / name, directory / f"{midi}.m4a",
                             cache / "processed" / kit.name / f"{midi}.wav", kit.max_s, gain)
            rows.append(f"| `{kit.name}/{midi}.m4a` | `{name}` | {layer} | "
                        f"{peak:+.1f} | {gain:+.1f} | {length:.2f} |")
        manifest[kit.name] = sorted(chosen)
        total = sum(path.stat().st_size for path in directory.glob("*.m4a"))
        layers = sorted({layer for _, layer, _ in chosen.values()})
        print(f"{kit.name:14s} {len(chosen):2d} notes  layers {','.join(layers):14s} "
              f"{total / 1024:7.0f} KiB  midi {min(chosen)}..{max(chosen)}")

    out.mkdir(parents=True, exist_ok=True)
    # The manifest is a reading of the directory, never a reading of this run.
    #
    # Writing it from `kits` was wrong in exactly one case, and that case happened: a
    # `--kit harp` rebuild left the other four kits' files on disk and erased them
    # from the manifest. Nothing failed. The client loads only what the manifest
    # lists, and a voice without a kit is left out by design (aircraft.ts), so four
    # of five aircraft voices simply were not in the piece — through two commits, a
    # render and a listening round. The LICENSE table below was already guarded
    # against the same partial run; the manifest, one line above it, was not.
    # tools/test-sample-pitch.py now fails if directory and manifest disagree.
    on_disk = {
        directory.name: sorted(int(path.stem) for path in directory.glob("*.m4a"))
        for directory in sorted(out.iterdir())
        if directory.is_dir()
    }
    written = {name: notes for name, notes in on_disk.items() if notes}
    missing = sorted(set(manifest) - set(written))
    if missing:
        print(f"  ! built but not on disk: {', '.join(missing)}", file=sys.stderr)
    (out / "manifest.json").write_text(json.dumps(written, indent=2, sort_keys=True) + "\n")

    kit_table = ["## Kits", "",
                 "| directory | VCSL instrument | used for |", "|---|---|---|"]
    kit_table += [f"| `{kit.name}/` | {kit.instrument} | {kit.used_for} |"
                  for kit in KITS]
    file_table = ["", "## Files", "",
                  "Peak is the source's **mono** peak in dBFS; gain is the lift applied to "
                  "reach a −3 dBFS peak.", "",
                  "| file | VCSL source | layer | peak dBFS | gain dB | length s |",
                  "|---|---|---|---|---|---|"] + rows
    if args.kit is None:
        (out / "LICENSE.md").write_text(
            LICENSE_HEAD + "\n".join(kit_table + file_table) + "\n")

    grand = sum(path.stat().st_size for path in out.rglob("*.m4a"))
    print(f"total {grand / 1024 / 1024:.2f} MiB  (SPEC §6.9 budget: 15 MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
