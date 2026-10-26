# Interim layered split of the curtain-pull pose (v0)

Made for free with `tools/alice-library/split_p6_layers.py` (numpy + Pillow) from
`reference/alice_ref_still03-text-free_v0.png`. Not the locked master.

| File | What it is |
|---|---|
| `alice.png` | Alice only |
| `curtain.png` | the white curtain in front of the code |
| `code.png` | Matrix Green code backdrop, extended behind the curtain (synthetic fill) |
| `composite-check.png` | the three layers stacked on white, for comparison with the source |

All layers are 820x959 RGBA and stack with no offsets: code, then curtain, then Alice.

## Known limits
- The source is a soft 820 px raster, so the layers are soft when enlarged.
- Curtain and code boundaries are hand-placed polygons; edges are slightly rough and the curtain's
  top-left edge is a straight cut through faint fold lines.
- The code behind the curtain is tiled from the visible part, not drawn.
- Good enough to test a curtain-reveal animation and to brief an artist. Not good enough to lock.
