#!/usr/bin/env python3
"""Free vector clean-up of the interim curtain-pull layers (MPC-7797-A4).

Traces animations/alice_p6_layers_v0/{alice,curtain}.png to SVG with Potrace
(`brew install potrace`), copies code.png as the raster code layer, and writes a
README plus compare.html (source PNG vs trace side by side, 300% zoom) into
animations/alice_p6_vector_v0/.

    python3 tools/alice-library/trace_p6_vector.py            # trace + README + compare.html
    python3 tools/alice-library/trace_p6_vector.py --register # after sign-off: add manifest entries

Does not redraw or restyle: it only thresholds the existing pixels. Ink is kept at
full detail (no speckle removal, light curve smoothing) so engraving hatching survives.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
ALICE = ROOT / "assets" / "alice"
SRC = ALICE / "animations" / "alice_p6_layers_v0"
OUT = ALICE / "animations" / "alice_p6_vector_v0"
MANIFEST = ALICE / "manifest.json"

SCALE = 4  # trace a 4x Lanczos upscale so curves are smoother than the 820 px pixel grid
# Luminance below this (0-255) counts as ink. The curtain is near-white with faint fold
# lines, so it needs a higher cut than Alice.
THRESHOLDS = {"alice": 170, "curtain": 215}
# Alice uses a local-contrast cut: a pixel is ink when it is darker than its surroundings by
# CONTRAST (so hatching lines separate instead of fusing) and below the threshold, or when it is
# dark outright (CORE). The curtain keeps a plain global cut.
LOCAL = {"alice": dict(radius=8, contrast=22, core=80)}
LAYERS = ("alice", "curtain")


def to_pbm(layer: str, threshold: int, path: Path) -> tuple[int, int]:
    im = Image.open(SRC / f"{layer}.png").convert("RGBA")
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    grey = Image.alpha_composite(white, im).convert("L")
    big = grey.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS)
    a = np.array(big).astype(float)
    local = LOCAL.get(layer)
    if local:
        mean = np.array(big.filter(ImageFilter.GaussianBlur(local["radius"])), dtype=float)
        ink = ((a < mean - local["contrast"]) & (a < threshold)) | (a < local["core"])
    else:
        ink = a < threshold
    Image.fromarray(np.where(ink, 0, 255).astype(np.uint8)).convert("1").save(path)
    return im.size


def trace(layer: str, threshold: int) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        pbm = Path(tmp) / f"{layer}.pbm"
        w, h = to_pbm(layer, threshold, pbm)
        svg = OUT / f"{layer}.svg"
        # -t 0: keep every speck (hatching); -a 1.0: light corner smoothing; -O 0.2: fine curve fit
        subprocess.run(
            ["potrace", "-s", "-t", "0", "-a", "1.0", "-O", "0.2", "-o", str(svg), str(pbm)],
            check=True,
        )
    text = svg.read_text()
    # Potrace sizes in pt of the upscaled bitmap; pin the SVG to the 820x959 layer canvas.
    text = re.sub(r'width="[^"]*"', f'width="{w}"', text, count=1)
    text = re.sub(r'height="[^"]*"', f'height="{h}"', text, count=1)
    svg.write_text(text)
    print(f"{layer}.svg  threshold {threshold}  {w}x{h}")


def write_compare() -> None:
    rows = "".join(
        f"<h2>{n}</h2><div class=r><div class=p><img src='../alice_p6_layers_v0/{n}.png'></div>"
        f"<div class=p><img src='{n}.svg'></div></div>"
        for n in LAYERS
    )
    (OUT / "compare.html").write_text(
        "<!doctype html><meta charset=utf-8><title>p6 trace vs source (300%)</title>"
        "<style>body{font:14px sans-serif;background:#fff}.r{display:flex;gap:16px}"
        ".p{flex:1;overflow:auto;height:80vh;border:1px solid #888;"
        "background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/20px 20px}"
        "img{width:2460px;display:block}</style>"
        "<h1>Trace vs source at 300%: left source PNG, right traced SVG (scroll together)</h1>"
        + rows
        + "<script>document.querySelectorAll('.r').forEach(r=>{const[a,b]=r.children;"
        "let l=0;const s=(x,y)=>()=>{if(l)return;l=1;y.scrollLeft=x.scrollLeft;y.scrollTop=x.scrollTop;l=0};"
        "a.onscroll=s(a,b);b.onscroll=s(b,a);"
        "addEventListener('load',()=>{a.scrollLeft=(a.scrollWidth-a.clientWidth)/2;"
        "a.scrollTop=(a.scrollHeight-a.clientHeight)/2})})</script>"
    )


def write_readme() -> None:
    (OUT / "README.md").write_text(
        """# Vector clean-up of the curtain-pull layers (v0)

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
  (curtain below 215 of 255; Alice by local contrast: darker than its surroundings by 22 and below 170, or below 80), traced with `potrace -t 0 -a 1.0 -O 0.2`.
- No speckle removal and only light curve smoothing, to keep the engraving hatching.
- Nothing redrawn or restyled; the paths follow the existing pixels.

## Known limits
- The source is a soft 820 px raster, so edges follow its softness. Vector makes it scale
  cleanly; it does not add detail that is not in the source.
- Single-threshold trace: tonal shading is reduced to ink or no ink.
- Line quality has to be accepted by the account holder before this is relied on.
"""
    )


def register() -> None:
    m = json.loads(MANIFEST.read_text())
    ids = {a["id"] for a in m["assets"]}
    new = [
        (f"interim-p6-vector-{n}", f"animations/alice_p6_vector_v0/{n}.svg",
         f"Potrace trace of interim-p6-layer-{n} (MPC-7797-A4). Reference only; follows the soft 820 px source.")
        for n in LAYERS
    ] + [
        ("interim-p6-vector-code", "animations/alice_p6_vector_v0/code.png",
         "Unchanged raster copy of the code layer, kept beside the traced layers (MPC-7797-A4).")
    ]
    for aid, path, note in new:
        if aid not in ids:
            m["assets"].append({"id": aid, "path": path, "kind": "interim-reference",
                                "required": False, "status": "reference-only", "note": note})
    MANIFEST.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
    print("manifest.json updated (reference-only)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", action="store_true", help="add manifest entries (after sign-off)")
    ap.add_argument("--alice-threshold", type=int, default=THRESHOLDS["alice"])
    ap.add_argument("--curtain-threshold", type=int, default=THRESHOLDS["curtain"])
    ap.add_argument("--radius", type=int, help="Alice local-contrast blur radius (default 8; smaller = finer)")
    ap.add_argument("--contrast", type=int, help="Alice: how much darker than surroundings counts as ink (default 22; higher = thinner lines)")
    ap.add_argument("--core", type=int, help="Alice: pixels darker than this are always ink (default 80)")
    args = ap.parse_args()
    for k in ("radius", "contrast", "core"):
        if getattr(args, k) is not None:
            LOCAL["alice"][k] = getattr(args, k)
    if args.register:
        register()
        return 0
    if shutil.which("potrace") is None:
        sys.exit("potrace not found: brew install potrace")
    OUT.mkdir(parents=True, exist_ok=True)
    trace("alice", args.alice_threshold)
    trace("curtain", args.curtain_threshold)
    shutil.copy2(SRC / "code.png", OUT / "code.png")
    write_readme()
    write_compare()
    print(f"done: open {OUT / 'compare.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
