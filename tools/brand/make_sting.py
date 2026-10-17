"""Generate the MyPrivacyTOOL brand sting (3.84 s, mono, 44.1 kHz) with free tools only.

Three soft bell-like notes (C5, G5, C6) over a low pad, a short echo and loudness
normalisation to about -23 LUFS. No samples, no licence: every sample is computed here.
Approved by Chris Ransford on 2026-10-17 as the brand sound logo.

    python3 tools/brand/make_sting.py assets/branding/audio/mpt-sting_v1.0.wav

Needs numpy and ffmpeg.
"""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
DUR = 3.6


def tone(t, f, start, length, amp, decay):
    n = np.arange(int(SR * length)) / SR
    env = np.exp(-n * decay) * np.minimum(1, n / 0.01)
    sig = (np.sin(2 * np.pi * f * n) + 0.35 * np.sin(2 * np.pi * 2 * f * n) + 0.12 * np.sin(2 * np.pi * 3 * f * n)) * env * amp
    out = np.zeros_like(t)
    i = int(start * SR)
    out[i:i + len(sig)] += sig[:len(out) - i]
    return out


def main(out_path: str) -> None:
    t = np.arange(int(SR * DUR)) / SR
    y = tone(t, 523.25, 0.00, 2.6, 0.5, 1.7) + tone(t, 783.99, 0.55, 2.6, 0.45, 1.7) + tone(t, 1046.5, 1.10, 2.4, 0.30, 2.0)
    pad = (np.sin(2 * np.pi * 130.81 * t) + 0.5 * np.sin(2 * np.pi * 196.0 * t)) * 0.12 * np.exp(-t * 0.7) * np.minimum(1, t / 0.3)
    y = y + pad
    y *= np.minimum(1, (DUR - t) / 0.6)
    y = y / np.max(np.abs(y)) * 0.8
    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / "raw.wav"
        with wave.open(str(raw), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((y * 32767).astype("<i2").tobytes())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af",
                        "aecho=0.6:0.5:120|240:0.25|0.15,loudnorm=I=-24:TP=-3:LRA=5", "-ar", str(SR), "-ac", "1", out_path],
                       check=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
