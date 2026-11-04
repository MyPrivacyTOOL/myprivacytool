#!/usr/bin/env python3
"""Generate the three Alice listener-test samples (CK-7728 part A): A.wav, B.wav, C.wav.

Local and free: sherpa-onnx + Kokoro models, ffmpeg for mastering. Needs
`pip install sherpa-onnx soundfile numpy imageio-ffmpeg` (imageio-ffmpeg supplies ffmpeg if none is on PATH).

  python3 generate_samples.py --v019 kokoro-en-v0_19 --v10 kokoro-multi-lang-v1_0 --out out/

Download the model folders from
https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models first.
Files are named A, B, C only; the key to which is which is in README.md.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import sherpa_onnx

SCRIPT = (
    "Hi, I'm Alice, your MyPrivacyTOOL guide. "
    "Let's peek behind the digital curtain to find out what information is available about you! "
    "Hover over any hexagon to see what I found, then click to confirm if it's correct."
)
# Pronunciation fix from MPC-7411: spell the brand as words.
SPOKEN = SCRIPT.replace("MyPrivacyTOOL", "My Privacy Tool")

# (id, model folder key, speaker id, speed, split on commas too, pause after clause in s)
SAMPLES = {
    "A": dict(model="v019", sid=8, speed=1.0, split_commas=False, pause=0.0, master=False),  # bf_isabella as today
    "B": dict(model="v10", sid=22, speed=0.9, split_commas=True, pause=0.4, master=True),    # bf_isabella, newer model
    "C": dict(model="v019", sid=7, speed=0.9, split_commas=True, pause=0.4, master=True),    # bf_emma
}


def tts_for(folder: Path, v10: bool):
    kokoro = dict(
        model=str(folder / "model.onnx"),
        voices=str(folder / "voices.bin"),
        tokens=str(folder / "tokens.txt"),
        data_dir=str(folder / "espeak-ng-data"),
    )
    if v10:
        kokoro.update(lexicon=",".join(str(p) for p in sorted(folder.glob("lexicon-*.txt"))),
                      dict_dir=str(folder / "dict"))
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(),
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(**kokoro),
            num_threads=4,
        )
    )
    return sherpa_onnx.OfflineTts(cfg)


def clauses(text: str, split_commas: bool):
    import re
    parts = re.split(r"(?<=[.!?,])\s+" if split_commas else r"(?<=[.!?])\s+", text)
    return [p for p in parts if p.strip()]


def render(tts, spec, text):
    chunks, rate = [], None
    for c in clauses(text, spec["split_commas"]):
        audio = tts.generate(c, sid=spec["sid"], speed=spec["speed"])
        if len(audio.samples) == 0:
            sys.exit(f"No audio generated for: {c!r} (check the model folder and espeak-ng-data)")
        rate = audio.sample_rate
        chunks.append(np.asarray(audio.samples, dtype=np.float32))
        chunks.append(np.zeros(int(rate * spec["pause"]), dtype=np.float32))
    return np.concatenate(chunks), rate


def ffmpeg_exe() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg not found: install it or run `pip install imageio-ffmpeg`")


def master(src: Path, dst: Path):
    subprocess.run(
        [ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "44100",
         "-af", "highpass=f=70,alimiter=limit=0.89,loudnorm=I=-18:TP=-3:LRA=7", str(dst)],
        check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--v019", required=True, type=Path)
    ap.add_argument("--v10", required=True, type=Path)
    ap.add_argument("--out", default=Path("out"), type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    engines = {"v019": tts_for(args.v019, False), "v10": tts_for(args.v10, True)}
    for name, spec in SAMPLES.items():
        samples, rate = render(engines[spec["model"]], spec, SPOKEN)
        raw = args.out / f"{name}.raw.wav"
        sf.write(raw, samples, rate)
        final = args.out / f"{name}.wav"
        if spec["master"]:
            master(raw, final)
            raw.unlink()
        else:
            raw.rename(final)  # A stays as it sounds today: no extra processing
        info = sf.info(final)
        print(f"{name}: {info.duration:.1f} s, {info.samplerate} Hz -> {final}")


if __name__ == "__main__":
    main()
