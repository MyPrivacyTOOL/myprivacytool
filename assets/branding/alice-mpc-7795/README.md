# MPC-7795 — Alice expression plates

Tenniel-style (1865 engraving) black ink on white, 2560x1440 PNG, waist-up.
Generated with Figma AI (gemini-3.1-flash-image) from text prompts, then upscaled and
levelled to black/white (Lanczos resize to 1440px height, levels 80-205, centred on white).

These are **flat rasters, not layered source files**, and proportions are not strictly locked
(no reference-image input; hair, pose and framing vary slightly between plates).

## Spec poses

| Spec pose | File |
|---|---|
| 1 Explaining | `alice-explaining-*` |
| 2 Curious | `alice-curious-*`, `alice-curious2-*` (two takes) |
| 3 Reflective | `alice-reflective-*` |
| 4 Alert | `alice-alert-*` |
| 5 Concerned | `alice-worried-*` (nearest; from an earlier default list, unconfirmed) |
| 6 Encouraging | `alice-delighted-*` (nearest; unconfirmed) |
| 7 Gesture set | `alice-pointing-*`, `alice-presenting-*` (gesture to screen), `alice-heart-*` (hand on heart) |

Extras from the earlier default list: `alice-neutral-*`, `alice-bemused-*`, `alice-determined-*`.

## Known issues
- `alice-presenting-*` renders the dress and sleeves dark (heavy cross-hatch); other plates have a light dress. Re-roll if it must match.
- Concerned and Encouraging are not generated against the spec prompt; the nearest earlier plates are used.
- No Brand Bible was found in the repo; plates are unchecked against it.
