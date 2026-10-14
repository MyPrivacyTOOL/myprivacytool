# Alice master reference library (MPC-7797)

The single source of truth for how Alice looks, moves and sounds. Goal: Alice in video 1 is
indistinguishable from Alice in video 50.

**Status: v0.1.0-draft.** Specs are written; the high-resolution art is not yet produced, so the
library cannot be locked as v1.0. `python3 tools/alice-library/validate_library.py` reports exactly
what is still missing. Do not call anything "v1.0" until that command exits 0 and a human signs off.

## Layout

```
assets/alice/
  manifest.json          every asset, its status, checksum once locked (machine-readable)
  CHANGELOG.md           version history
  spec/
    character-sheet.md   face, proportions, hair/dress/apron, pose list
    animation-production.md   fps, framing, motion, expression map
    voice.md             voice engine, settings, licensing
    validation-checklist.md   pre-ship gate + consistency audit
  faces/                 front / side / three-quarter heads
  poses/                 full-body poses
  expressions/           expression sheet
  animations/            layered source + approved motion loops
  voice/                 approved voice samples (reference renders)
  reference-clips/       the 15 legacy 560x560 clips (reference only, never published)
```

## Rules for anyone (human or AI) making Alice content

1. Read `spec/character-sheet.md` and `spec/animation-production.md` first. Use only assets
   listed in `manifest.json` with `status: "locked"`.
2. Never redraw, restyle or "improve" Alice. Never generate her from a text prompt alone: start
   from a locked reference image (image-to-video; see `docs/kling-ai-prompt-engineering-guidelines.md`).
3. Colours: white, black and the brand green only. No greys beyond engraving hatching, no colour fills.
4. The 560x560 legacy clips are reference only. Do not publish or upscale them.
5. Use the voice exactly as in `spec/voice.md`. Do not swap voices or tune settings per video.
6. Before shipping, complete `spec/validation-checklist.md` and file the result with the video.
7. Need a change to Alice? Open a ticket; changes go through a version bump (below), never an
   in-place edit of a locked file.

## Versioning

Semantic: `MAJOR.MINOR.PATCH`.

- **MAJOR**: Alice's look, proportions or voice change. Videos made against the old major are
  not re-validated; new videos use the new one.
- **MINOR**: new poses, expressions or animations added. Existing locked assets untouched.
- **PATCH**: documentation fixes, or a locked file replaced by a higher-resolution version of the
  identical drawing.

Locked assets are immutable: `manifest.json` stores each one's SHA-256 and the validator fails if a
locked file changes. To change one, add a new file, bump the version and log it in `CHANGELOG.md`.
Tag the repo `alice-vX.Y.Z` when a version is locked.

## File naming

`alice_<kind>_<descriptor>_v<MAJOR.MINOR>.<ext>`, lower case, e.g. `alice_pose_curtain-pull_v1.0.png`,
`alice_expr_curious_v1.0.png`, `alice_face_three-quarter_v1.0.png`.
Art is transparent-background PNG (no baked-in text), or layered PSD/SVG for animation sources.
