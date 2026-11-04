# Vector clean-up of the curtain-pull layers (v0)

Free trace (MPC-7797-A4) of `../alice_p6_layers_v0/` with Potrace, run by
`tools/alice-library/trace_p6_vector.py`. Reference only. Not the locked master, and it does not
lock v1.0.

| File | What it is |
|---|---|
| `alice.svg` | Alice only, ink as vector paths on transparent |
| `curtain.svg` | curtain fold lines and edges, ink as vector paths on transparent |
| `code.png` | Matrix Green code backdrop, unchanged raster copy |
| `compare.html` | source PNG next to each trace at 300% zoom, for the line-quality check |

All layers use the 820x959 canvas and stack with no offsets: code, curtain, Alice.

## Method
- Layer composited on white, converted to grey, Lanczos-upscaled 4x, thresholded to ink
  (local contrast: a pixel is ink when it is darker than its surroundings by 22 and below 170, or below 80 for Alice; 14, 200 and 110 for the curtain, whose folds are fainter), traced with `potrace -t 0 -a 1.0 -O 0.2`.
- No speckle removal and only light curve smoothing, to keep the engraving hatching.
- Nothing redrawn or restyled; the paths follow the existing pixels.

## Known limits
- The source is a soft 820 px raster, so edges follow its softness. Vector makes it scale
  cleanly; it does not add detail that is not in the source.
- Single-threshold trace: tonal shading is reduced to ink or no ink.
- Line quality has to be accepted by the account holder before this is relied on.
