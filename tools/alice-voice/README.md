# Alice voice samples (CK-7728 part A)

Three samples for the Alice listener test (MPC-7725 part C). All read the same
script (about 25 s, Alice's real site lines). Files are named **A, B, C only**
and played in a different random order for each listener; this key is for the
facilitator and must not be shown to listeners.

| File | Model | Voice | Delivery |
|------|-------|-------|----------|
| A | Kokoro v0.19 | `bf_isabella` (speaker 8) | As it sounds today: speed 1.0, whole sentences, no processing |
| B | Kokoro v1.0 multi-lang (newer) | `bf_isabella` (speaker 22) | Speed 0.9, 0.4 s pauses at commas and sentence ends, highpass 70 Hz, limiter 0.89, loudnorm I=-18 TP=-3 LRA=7, mono 44.1 kHz |
| C | Kokoro v0.19 | `bf_emma` (speaker 7, from the model's speaker order; confirm against the model metadata) | Same delivery and mastering as B |

Run: `python3 generate_samples.py --v019 <kokoro-en-v0_19> --v10 <kokoro-multi-lang-v1_0> --out out/`
after `pip install sherpa-onnx soundfile numpy` (ffmpeg on PATH). Models:
<https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models>. Zero spend, all local.

The script sentence uses "My Privacy Tool" for pronunciation (MPC-7411).

## Status

- Script and settings written 2026-10-13. **Audio not yet generated:** the build
  sandbox's network policy blocks PyPI (HTTP 403), so `sherpa-onnx` could not be
  installed there. Run the script on a machine that has it (the Mac used for MPC-7411).
- The listener test and choosing a winner are Chris's (MPC-7725 part C). No audio of
  Alice is published until a sample passes the test.

## Licence notes

- **kokoro-en-v0_19** (read 2026-10-13): the package ships the full Apache License 2.0
  (`LICENSE`, 202 lines, unmodified boilerplate) and a README pointing to
  <https://huggingface.co/hexgrad/Kokoro-82M>. Archive SHA-256
  `912804855a04745fa77a30be545b3f9a5d15c4d66db00b88cbcd4921df605ac7`.
  Apache 2.0 permits commercial use. Keeping the licence text and notices is required
  only when redistributing the model itself, not for audio it generates.
- **kokoro-multi-lang-v1_0** (sample B): not downloaded in the build sandbox this time.
  Earlier finding (MPC-7411, Alice page "Alice voice standard"): Apache 2.0, model card
  states no attribution or restrictions on generated audio; attribution applies only to
  training audio (Koniwa CC BY 3.0, SIWIS CC BY 4.0), the model authors' obligation.
  **Re-read the `LICENSE` in the v1.0 package when the samples are generated.**
- Not read: the Hugging Face v0.19 discussion thread (returned HTTP 403 in MPC-7411).
- This is an engineering reading, not legal advice; the public-use sign-off is Chris's.
