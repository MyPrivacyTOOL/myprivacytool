# Video pipeline (MPC-7415)

Turns an approved script file into a finished YouTube Short: 1080x1920 MP4 with Alice's
voice, burned-in captions, an `.srt` file and a 1280x720 thumbnail. Free tools only,
no keys, and it **never uploads anything**.

## One command

```bash
python3 tools/video-pipeline/build_short.py tools/video-pipeline/examples/mpt-yt-s010.json \
  --model-dir /path/to/kokoro-en-v0_19 --alice /path/to/alice.png --out out/
```

Outputs, named per the File Naming Convention:

```
mpt-yt-s010_singapore-dnc-registry_en_9x16_v1.mp4
mpt-yt-s010_singapore-dnc-registry_en.srt
mpt-yt-s010_singapore-dnc-registry_thumb-a.jpg
```

## Setup

- `ffmpeg` 6+ (with the `subtitles`, `zoompan`, `loudnorm` filters) and the Inter font
  (`/usr/share/fonts/opentype/inter`, or edit `INTER_DIR`).
- `pip install sherpa-onnx numpy pillow`
- Voice model: download `kokoro-en-v0_19.tar.bz2` from
  <https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models> (Apache 2.0) and unpack it.
- `--alice` is Alice's drawing (PNG). Use the approved text-free reference (see MPC-7401).
  The art is **not** stored in this repository.

## What it does

Voice: Kokoro v0.19, voice `bf_isabella` (speaker 8), speed 0.95, one clip per beat, 0.3 s
pauses, 0.2 s lead-in, 0.4 s tail, then -1 semitone with speed unchanged, high-pass 70 Hz,
limiter and loudnorm to -18 LUFS (the settings approved in MPC-7411).
Captions are the narration word for word, split into chunks of at most 7 words and timed
from the real clip lengths. Picture: white paper, Inter type, Alice whole, one green bar;
each beat gets a slow zoom and drift. Optional `--music FILE` mixes in a track at low
level, ducked under the voice.

## Script file

```json
{ "id": "MPT-YT-S010", "slug": "singapore-dnc-registry", "title": "…", "language": "en",
  "beats": [ { "narration": "…word for word…", "on_screen": "text shown for this beat" } ] }
```

`id` like `MPT-YT-S010`; `slug` 2 to 5 lower-case words; one beat per spoken clause.
Narration must be the approved script **word for word**: this tool checks the format, not
the claims. Claims go through MPC-7402 before a script is written.

## What it cannot do yet

- **No curtain reveal.** Only slow zoom and drift. The curtain animation needs the artwork
  split into layers (Alice, curtain, code).
- **Art quality is only as good as the PNG you give it.** The reference we have is 820 px
  wide and is upscaled.
- **No music is bundled.** YouTube Audio Library tracks must be downloaded by a person
  (and the licence PDF filed per the naming page); `--music` is untested with real tracks.
- `--silent` makes a video with no voice, for layout checks only. Never publish it.
- Not tested in CI: the real-voice path needs the 320 MB model.

## Tests

```bash
cd tools/video-pipeline && python3 -m unittest -v test_build_short
```

## Brand sting (optional)

`--sting assets/branding/audio/mpt-sting_v1.0.wav` adds the approved sound logo: it plays at the start and
again after the last word, ducked under any voice, and the first and last picture are held while it plays
(`--intro-hold`, default 1.5 s, and `--outro-hold`, default 2.0 s; both default to 0 without `--sting`).
Captions and timings shift with the holds. `--sting` and `--music` cannot be combined. Without either, the
output is unchanged (0.2 s lead-in, 0.4 s tail).
