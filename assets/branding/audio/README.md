# Brand audio

`mpt-sting_v1.0.wav`: the MyPrivacyTOOL sting (3.84 s, mono, 44.1 kHz, about -23 LUFS). Three soft
bell notes over a low pad. **Approved by Chris Ransford on 2026-10-17 as the brand sound logo.**

It is generated, not sampled, so there is no third-party licence or credit. To regenerate it exactly
(the output is byte-identical): `python3 tools/brand/make_sting.py assets/branding/audio/mpt-sting_v1.0.wav`
(needs numpy and ffmpeg). Never edit the file in place; a change is a new version.

Use it with the video pipeline: `--sting assets/branding/audio/mpt-sting_v1.0.wav` plays it at the start
and again after the last word, holding the first picture for 1.5 s and the last for 2.0 s
(`--intro-hold` and `--outro-hold` change those). There is no music bed: the Shorts are voice-led.
