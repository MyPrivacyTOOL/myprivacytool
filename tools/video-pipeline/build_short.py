#!/usr/bin/env python3
"""MPC-7415: turn an approved script file into a finished Short (9:16, 1080x1920).

One command:

    python3 tools/video-pipeline/build_short.py script.json --alice alice.png --out out/

Outputs, named per the File Naming Convention
({id}_{slug}_{language}_{aspect}_{version}.{ext}):

    mpt-yt-s010_singapore-dnc-registry_en_9x16_v1.mp4   the Short
    mpt-yt-s010_singapore-dnc-registry_en.srt           caption file
    mpt-yt-s010_singapore-dnc-registry_thumb-a.jpg      1280x720 thumbnail, under 2 MB

This tool never uploads anything and needs no keys. Free tools only: ffmpeg,
Pillow, numpy and (for the real voice) sherpa-onnx with the Kokoro v0.19 model.
See README.md for the exact setup and what it cannot do yet.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

W, H = 1080, 1920
FPS = 30
SAMPLE_RATE_OUT = 44100

# Approved voice standard (MPC-7411): Kokoro v0.19, voice bf_isabella, speaker id 8.
VOICE_SID = 8
VOICE_SPEED = 0.95
LEAD_IN_S = 0.2
PAUSE_S = 0.3
TAIL_S = 0.4
# Optional brand sting (approved 2026-10-17): the first and last picture are held while it plays.
STING_INTRO_HOLD_S = 1.5
STING_OUTRO_HOLD_S = 2.0
PITCH_SEMITONES = -1

INTER_DIR = Path("/usr/share/fonts/opentype/inter")
FONT_BOLD_CANDIDATES = [INTER_DIR / "Inter-Bold.otf", INTER_DIR / "Inter-ExtraBold.otf"]
FONT_REGULAR_CANDIDATES = [INTER_DIR / "Inter-Regular.otf", INTER_DIR / "Inter-Medium.otf"]

GREEN = (39, 174, 96)  # Matrix Green #27AE60 (locked brand palette)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

MAX_CAPTION_WORDS = 7


class ScriptError(ValueError):
    pass


@dataclass
class Beat:
    narration: str
    on_screen: str


@dataclass
class Script:
    id: str
    slug: str
    title: str
    language: str
    beats: list[Beat]


def load_script(path: Path) -> Script:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ScriptError(f"{path}: not valid JSON ({exc})") from exc
    return parse_script(raw)


def parse_script(raw: dict) -> Script:
    for key in ("id", "slug", "title", "beats"):
        if key not in raw:
            raise ScriptError(f"script is missing '{key}'")
    sid = str(raw["id"]).strip().lower()
    if not re.fullmatch(r"mpt-yt-[a-z]\d+", sid):
        raise ScriptError(f"id '{raw['id']}' must look like MPT-YT-S010 (case-insensitive)")
    slug = str(raw["slug"]).strip().lower()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+){1,4}", slug):
        raise ScriptError(f"slug '{raw['slug']}' must be 2 to 5 lower-case words joined by hyphens")
    language = str(raw.get("language", "en")).strip().lower()
    if not re.fullmatch(r"[a-z]{2}(-[a-z]{2})?", language):
        raise ScriptError(f"language '{language}' must be like en or zh-hk")
    title = str(raw["title"]).strip()
    if not title or len(title) > 100:
        raise ScriptError("title must be 1 to 100 characters")
    beats_raw = raw["beats"]
    if not isinstance(beats_raw, list) or not beats_raw:
        raise ScriptError("'beats' must be a non-empty list")
    beats = []
    for i, b in enumerate(beats_raw, 1):
        narration = str(b.get("narration", "")).strip()
        on_screen = str(b.get("on_screen", "")).strip()
        if not narration:
            raise ScriptError(f"beat {i} has no narration")
        if len(on_screen) > 120:
            raise ScriptError(f"beat {i} on_screen text is over 120 characters")
        beats.append(Beat(narration, on_screen))
    return Script(sid, slug, title, language, beats)


def output_names(script: Script, version: int = 1) -> dict[str, str]:
    base = f"{script.id}_{script.slug}"
    return {
        "video": f"{base}_{script.language}_9x16_v{version}.mp4",
        "srt": f"{base}_{script.language}.srt",
        "thumb": f"{base}_thumb-a.jpg",
    }


# --------------------------------------------------------------------------- voice


def estimate_seconds(text: str) -> float:
    """Duration used by the silent stand-in voice (not for real output)."""
    return max(0.8, 0.38 * len(text.split()))


class SilentVoice:
    """Stand-in for tests and layout checks. Produces silence. NOT for publishing."""

    sample_rate = 24000

    def synth(self, text: str):
        import numpy as np

        return np.zeros(int(estimate_seconds(text) * self.sample_rate), dtype="float32")


class KokoroVoice:
    """Kokoro v0.19, voice bf_isabella (speaker id 8), via sherpa-onnx."""

    def __init__(self, model_dir: Path):
        import sherpa_onnx

        model_dir = Path(model_dir)
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(model_dir / "model.onnx"),
                    voices=str(model_dir / "voices.bin"),
                    tokens=str(model_dir / "tokens.txt"),
                    data_dir=str(model_dir / "espeak-ng-data"),
                ),
                num_threads=4,
                provider="cpu",
            )
        )
        if not cfg.validate():
            raise RuntimeError(f"sherpa-onnx rejected the Kokoro config in {model_dir}")
        self._tts = sherpa_onnx.OfflineTts(cfg)
        self.sample_rate = self._tts.sample_rate

    def synth(self, text: str):
        import numpy as np

        audio = self._tts.generate(text, sid=VOICE_SID, speed=VOICE_SPEED)
        return np.asarray(audio.samples, dtype="float32")


@dataclass
class Timeline:
    """Where each beat sits on the raw (pre-mastering) voice track, in seconds."""

    starts: list[float]
    ends: list[float]
    total: float


def build_voice_track(script: Script, voice, hold_in: float = 0.0, hold_out: float = 0.0) -> tuple["object", Timeline]:
    """Each beat is generated separately (the approved sample was), joined with
    0.3 s pauses, 0.2 s lead-in and 0.4 s tail. `hold_in` and `hold_out` add silent seconds
    before the first and after the last beat (the first and last picture stay on screen)."""
    import numpy as np

    sr = voice.sample_rate
    lead_in = LEAD_IN_S + hold_in
    pieces = [np.zeros(int(lead_in * sr), dtype="float32")]
    t = lead_in
    starts, ends = [], []
    for i, beat in enumerate(script.beats):
        clip = voice.synth(beat.narration)
        starts.append(t)
        t += len(clip) / sr
        ends.append(t)
        pieces.append(clip)
        gap = PAUSE_S if i < len(script.beats) - 1 else TAIL_S + hold_out
        pieces.append(np.zeros(int(gap * sr), dtype="float32"))
        t += gap
    return np.concatenate(pieces), Timeline(starts, ends, t)


def write_wav(path: Path, samples, sample_rate: int) -> None:
    import numpy as np

    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())


def master_voice(raw_wav: Path, sample_rate: int, out_wav: Path) -> None:
    """Approved mastering chain (MPC-7411): -1 semitone with speed unchanged,
    high-pass 70 Hz, limiter, loudnorm -18 LUFS, mono 44.1 kHz."""
    shift = 2 ** (PITCH_SEMITONES / 12)
    chain = (
        f"asetrate={sample_rate * shift:.3f},aresample={SAMPLE_RATE_OUT},atempo={1 / shift:.6f},"
        "highpass=f=70,alimiter=limit=0.89,loudnorm=I=-18:TP=-3:LRA=7"
    )
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw_wav), "-af", chain, "-ac", "1",
         "-ar", str(SAMPLE_RATE_OUT), str(out_wav)])


# --------------------------------------------------------------------------- captions


@dataclass
class Cue:
    start: float
    end: float
    text: str


def _two_lines(words: list[str]) -> str:
    """Break a caption of more than 4 words into two balanced lines at a word boundary, so the
    renderer never has to wrap inside a hyphenated word such as Do-Not-Call."""
    if len(words) <= 4:
        return " ".join(words)
    half = math.ceil(len(words) / 2)
    return " ".join(words[:half]) + "\n" + " ".join(words[half:])


def make_cues(script: Script, tl: Timeline, max_words: int = MAX_CAPTION_WORDS) -> list[Cue]:
    """Captions are the narration word for word. A beat is split into chunks of at
    most `max_words` words, each timed by its share of the beat's letters."""
    cues: list[Cue] = []
    for beat, start, end in zip(script.beats, tl.starts, tl.ends):
        words = beat.narration.split()
        n_chunks = max(1, math.ceil(len(words) / max_words))
        per = math.ceil(len(words) / n_chunks)
        chunks = [_two_lines(words[i:i + per]) for i in range(0, len(words), per)]
        weights = [max(1, len(c)) for c in chunks]
        total_w = sum(weights)
        t = start
        for chunk, wt in zip(chunks, weights):
            dur = (end - start) * wt / total_w
            cues.append(Cue(t, t + dur, chunk))
            t += dur
    return cues


def srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(cues: list[Cue]) -> str:
    out = []
    for i, c in enumerate(cues, 1):
        out.append(f"{i}\n{srt_time(c.start)} --> {srt_time(c.end)}\n{c.text}\n")
    return "\n".join(out)


# --------------------------------------------------------------------------- frames


def find_font(candidates: list[Path]) -> Path:
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(
        "Inter font not found. Install it (e.g. apt install fonts-inter) or edit INTER_DIR in build_short.py."
    )


def wrap_text(draw, text: str, font, max_width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def render_frame(beat: Beat, alice_path: Path | None, out_png: Path) -> None:
    """White paper, black ink, Inter type, Alice whole, one green bar. Captions are
    added later by ffmpeg, so this leaves the bottom band clear."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)
    # Shrink the headline until its longest word (e.g. a URL) fits inside the side margins.
    headline_size = 92
    bold = ImageFont.truetype(str(find_font(FONT_BOLD_CANDIDATES)), headline_size)
    if beat.on_screen:
        while headline_size > 48 and max(d.textlength(w, font=bold) for w in beat.on_screen.split()) > W - 140:
            headline_size -= 4
            bold = ImageFont.truetype(str(find_font(FONT_BOLD_CANDIDATES)), headline_size)
    small = ImageFont.truetype(str(find_font(FONT_BOLD_CANDIDATES)), 40)
    d.text((70, 80), "MyPrivacyTOOL", font=small, fill=BLACK)

    y = 230
    if beat.on_screen:
        for line in wrap_text(d, beat.on_screen, bold, W - 140):
            d.text((70, y), line, font=bold, fill=BLACK)
            y += 112
        d.rectangle([70, y + 20, 70 + 520, y + 36], fill=GREEN)

    if alice_path:
        alice = Image.open(alice_path).convert("RGBA")
        bg = Image.new("RGBA", alice.size, (255, 255, 255, 255))
        alice = Image.alpha_composite(bg, alice).convert("RGB")
        top, bottom = 700, 1560
        scale = min((W - 120) / alice.width, (bottom - top) / alice.height)
        size = (int(alice.width * scale), int(alice.height * scale))
        alice = alice.resize(size, Image.LANCZOS)
        img.paste(alice, ((W - size[0]) // 2, bottom - size[1]))
    img.save(out_png)


def render_thumbnail(script: Script, alice_path: Path | None, out_jpg: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    tw, th = 1280, 720
    img = Image.new("RGB", (tw, th), WHITE)
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype(str(find_font(FONT_BOLD_CANDIDATES)), 84)
    small = ImageFont.truetype(str(find_font(FONT_BOLD_CANDIDATES)), 34)
    d.text((60, 50), "MyPrivacyTOOL", font=small, fill=BLACK)
    y = 150
    for line in wrap_text(d, script.title, big, 700):
        d.text((60, y), line, font=big, fill=BLACK)
        y += 100
    d.rectangle([60, y + 20, 60 + 420, y + 34], fill=GREEN)
    if alice_path:
        alice = Image.open(alice_path).convert("RGBA")
        bg = Image.new("RGBA", alice.size, (255, 255, 255, 255))
        alice = Image.alpha_composite(bg, alice).convert("RGB")
        scale = min(480 / alice.width, 640 / alice.height)
        size = (int(alice.width * scale), int(alice.height * scale))
        alice = alice.resize(size, Image.LANCZOS)
        img.paste(alice, (tw - size[0] - 60, th - size[1] - 40))
    quality = 92
    while True:
        img.save(out_jpg, "JPEG", quality=quality)
        if out_jpg.stat().st_size < 2_000_000 or quality <= 40:
            break
        quality -= 8


# --------------------------------------------------------------------------- video


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed:\n{proc.stderr.strip()}")


def render_beat_clip(frame_png: Path, seconds: float, index: int, out_mp4: Path) -> None:
    """Simple moves only: a slow zoom, drifting left on odd beats and right on even."""
    frames = max(1, int(round(seconds * FPS)))
    drift = "iw/2-(iw/zoom/2)+on*0.15" if index % 2 else "iw/2-(iw/zoom/2)-on*0.15"
    zoom = f"min(1+0.0004*on,1.06)"
    vf = (
        f"scale={W * 2}:{H * 2},"
        f"zoompan=z='{zoom}':x='{drift}':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},"
        "format=yuv420p"
    )
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(frame_png), "-vf", vf,
         "-frames:v", str(frames), "-c:v", "libx264", "-preset", "medium", "-crf", "18", str(out_mp4)])


def subtitles_filter(srt: Path) -> str:
    # libass sizes SRT styles against a 384x288 canvas and scales them up to the
    # video, so these numbers are in that canvas: 9.6 is about 64 px at 1920 high.
    style = (
        "FontName=Inter,FontSize=9.6,Bold=1,PrimaryColour=&H00000000,OutlineColour=&H00FFFFFF,"
        "BorderStyle=1,Outline=0.9,Shadow=0,Alignment=2,MarginV=26"
    )
    esc = str(srt).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return f"subtitles='{esc}':fontsdir={INTER_DIR}:force_style='{style}'"


def mix_music(voice_wav: Path, music: Path, out_wav: Path, seconds: float) -> None:
    """Music sits low and ducks under the voice so it never masks it."""
    fc = (
        "[0:a]aloop=loop=-1:size=2147483647,volume=0.10[m];"
        "[m][1:a]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=500[duck];"
        "[1:a][duck]amix=inputs=2:duration=first:normalize=0[out]"
    )
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(music), "-i", str(voice_wav),
         "-filter_complex", fc, "-map", "[out]", "-t", f"{seconds:.3f}",
         "-ar", str(SAMPLE_RATE_OUT), "-ac", "1", str(out_wav)])


def mix_sting(voice_wav: Path, sting: Path, out_wav: Path, tl: Timeline, hold_in: float, hold_out: float) -> None:
    """The brand sting plays once at the start and once after the last word, ducked under any voice."""
    intro_len = LEAD_IN_S + hold_in + 1.0
    outro_len = TAIL_S + hold_out
    outro_ms = int(round(tl.ends[-1] * 1000))
    fc = (
        f"[1:a]atrim=0:{intro_len:.3f},afade=t=out:st={max(0.0, intro_len - 1.0):.3f}:d=1.0,volume=0.9[s1];"
        f"[2:a]atrim=0:{outro_len:.3f},afade=t=out:st={max(0.0, outro_len - 1.2):.3f}:d=1.2,volume=0.9,"
        f"adelay={outro_ms}|{outro_ms}[s2];"
        "[s1][s2]amix=inputs=2:normalize=0:duration=longest[st];"
        "[0:a]asplit=2[v][vsc];"
        "[st][vsc]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[duck];"
        "[v][duck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[out]"
    )
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(voice_wav), "-i", str(sting), "-i", str(sting),
         "-filter_complex", fc, "-map", "[out]", "-t", f"{tl.total:.3f}",
         "-ar", str(SAMPLE_RATE_OUT), "-ac", "1", str(out_wav)])


def build(script: Script, voice, out_dir: Path, alice: Path | None, music: Path | None = None,
          version: int = 1, sting: Path | None = None, hold_in: float = 0.0, hold_out: float = 0.0) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    names = output_names(script, version)
    with tempfile.TemporaryDirectory() as tmp_s:
        tmp = Path(tmp_s)
        samples, tl = build_voice_track(script, voice, hold_in, hold_out)
        raw_wav, voice_wav = tmp / "raw.wav", tmp / "voice.wav"
        write_wav(raw_wav, samples, voice.sample_rate)
        master_voice(raw_wav, voice.sample_rate, voice_wav)

        audio_wav = voice_wav
        if music:
            audio_wav = tmp / "mixed.wav"
            mix_music(voice_wav, music, audio_wav, tl.total)
        elif sting:
            audio_wav = tmp / "mixed.wav"
            mix_sting(voice_wav, sting, audio_wav, tl, hold_in, hold_out)

        cues = make_cues(script, tl)
        srt_path = out_dir / names["srt"]
        srt_path.write_text(to_srt(cues), encoding="utf-8")

        # Each beat is shown from the end of the previous beat (or 0) to its own end
        # plus the pause that follows it, so the picture never lags the voice.
        bounds = [0.0] + [tl.starts[i + 1] for i in range(len(script.beats) - 1)] + [tl.total]
        clips = []
        for i, beat in enumerate(script.beats):
            frame = tmp / f"frame{i}.png"
            render_frame(beat, alice, frame)
            clip = tmp / f"clip{i}.mp4"
            render_beat_clip(frame, bounds[i + 1] - bounds[i], i, clip)
            clips.append(clip)
        concat = tmp / "concat.txt"
        concat.write_text("".join(f"file '{c}'\n" for c in clips), encoding="utf-8")
        silent = tmp / "silent.mp4"
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat),
             "-c", "copy", str(silent)])

        video_path = out_dir / names["video"]
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent), "-i", str(audio_wav),
             "-vf", subtitles_filter(srt_path), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
             "-movflags", "+faststart", str(video_path)])

        thumb_path = out_dir / names["thumb"]
        render_thumbnail(script, alice, thumb_path)
    return {"video": video_path, "srt": srt_path, "thumb": thumb_path}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("script", type=Path, help="script JSON (see README.md)")
    ap.add_argument("--out", type=Path, default=Path("out"), help="output folder")
    ap.add_argument("--alice", type=Path, help="Alice drawing (PNG); the approved text-free reference")
    ap.add_argument("--model-dir", type=Path, help="Kokoro v0.19 folder (model.onnx, voices.bin, tokens.txt, espeak-ng-data)")
    ap.add_argument("--silent", action="store_true", help="no voice: layout and caption check only, NOT for publishing")
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument("--music", type=Path, help="optional music file from the approved free source (a quiet bed under the whole video)")
    grp.add_argument("--sting", type=Path, help="brand sting (assets/branding/audio): played at the start and after the last word, with the first and last picture held")
    ap.add_argument("--intro-hold", type=float, default=None, help=f"seconds to hold the first picture before the voice (default {STING_INTRO_HOLD_S} with --sting, else 0)")
    ap.add_argument("--outro-hold", type=float, default=None, help=f"seconds to hold the last picture after the voice (default {STING_OUTRO_HOLD_S} with --sting, else 0)")
    ap.add_argument("--version", type=int, default=1)
    args = ap.parse_args(argv)

    try:
        script = load_script(args.script)
    except (ScriptError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.silent:
        voice = SilentVoice()
        print("WARNING: --silent produces a video with NO voice. Check layout only; do not publish.", file=sys.stderr)
    else:
        if not args.model_dir:
            print("error: give --model-dir (Kokoro v0.19 folder) or --silent", file=sys.stderr)
            return 2
        voice = KokoroVoice(args.model_dir)
    hold_in = args.intro_hold if args.intro_hold is not None else (STING_INTRO_HOLD_S if args.sting else 0.0)
    hold_out = args.outro_hold if args.outro_hold is not None else (STING_OUTRO_HOLD_S if args.sting else 0.0)
    if min(hold_in, hold_out) < 0:
        print("error: holds cannot be negative", file=sys.stderr)
        return 2
    paths = build(script, voice, args.out, args.alice, args.music, args.version, args.sting, hold_in, hold_out)
    for kind, p in paths.items():
        print(f"{kind}: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
