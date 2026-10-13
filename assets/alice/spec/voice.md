# Alice voice spec

## Locked engine (as shipped, MPC-7411 / MPC-7415)

| Item | Value |
|---|---|
| Engine | Kokoro TTS v0.19 via `sherpa-onnx`, run locally |
| Voice | `bf_isabella` (British English female), speaker id 8 |
| Model | `kokoro-en-v0_19` (`kokoro-en-v0_19.tar.bz2` from the sherpa-onnx `tts-models` release) |
| Speed | 0.95 |
| Pitch | -1 semitone, tempo unchanged (post-processed) |
| Structure | one clip per beat, 0.3 s pause, 0.2 s lead-in, 0.4 s tail |
| Mastering | high-pass 70 Hz, limiter, loudnorm to -18 LUFS |
| Cost | none; offline, no API key, no per-use fee |

Do not change any value per video. A change is a MAJOR version.

## Why this and not a paid service

Kokoro runs offline, is free, and gives an identical voice every render (deterministic settings, no
vendor drift or model retirement). ElevenLabs or Google TTS would add a key, recurring cost and the
risk the voice changes when the vendor updates. A custom recording remains an option later, but it
needs a contract and consent record.

## Tone

Warm, clear, unhurried. Plain words, no jargon, no alarm, no sales voice. Short sentences, one idea
each. British spelling and phrasing in scripts. Numbers spelled as spoken ("twenty-one days").
Claims must be on the approved claims list (MPC-7402).

## Licensing (reuse across videos)

- Kokoro model and sherpa-onnx: Apache 2.0, which permits commercial use and redistribution of
  generated audio. Keep the licence text and model version in the release notes of each video.
- Generated audio carries no per-video fee. Record the model version and speaker id in each video's
  metadata so any video can be re-rendered identically.
- **Open item, needs human confirmation:** the v0.19 voice pack's upstream attribution/terms for
  `bf_isabella` should be read once and the result logged in `manifest.json` (`open_decisions`).
  Until then, treat commercial use as "believed permitted, not yet confirmed".
- If the voice is ever replaced by a human recording, obtain a signed licence covering all media,
  all videos, perpetual, plus consent for synthetic derivatives.

## Reference renders

`voice/` holds approved 10-second reference renders of three fixed test lines (neutral, question,
warning) so any future render can be compared by ear and by loudness/spectrogram.
