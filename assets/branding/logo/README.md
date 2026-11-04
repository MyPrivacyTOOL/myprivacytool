# Logo vectors (v1.0)

Vector versions of the approved logo ("MyPrivacyTOOL.IO - Final Logo & Name - V.Final", locked
2026-06-20, Google Drive, raster PNG 2208x1242). **Status: v1.0, approved as final by Chris Ransford on 2026-10-17.** Never edit a file in place; a change is a new version.

| File | Use |
|---|---|
| `mpt-logo-primary-black_v1.0.svg` | black on light backgrounds (default) |
| `mpt-logo-reversed-white_v1.0.svg` | white on dark or green backgrounds; no background rectangle |
| `mpt-logo-icon-black_v1.0.svg` | mark only (figure in circle with the crescent ring), for avatars and anything 64 px or larger |
| `mpt-logo-favicon-black_v1.0.svg` | disc and figure only, no crescent, for favicons (16, 32, 48 px) and the Apple touch icon |

## How they were made
Automatically traced from the approved PNG with `tools/brand/trace_logo.py` (numpy + Pillow, no
paid or online tools): threshold, marching squares, simplification, smoothed curves. Nothing was
redrawn or restyled. Reproduce: `python3 tools/brand/trace_logo.py logo.png out.svg full '#000000'`
(modes: `full`, `icon`).

## Known limits (accepted at approval)
- Traced from a soft raster, so small corner details are slightly rounded compared with a hand-drawn vector.
- The wordmark is outlines, not live text. Its two typefaces (a serif for "MyPrivacy", a bold
  condensed sans for "TOOL.IO") are not yet identified.
- The logo reads "MyPrivacyTOOL.IO"; the brand name in text stays "MyPrivacyTOOL".
- Checked 2026-10-17 at 16, 32, 64 and 128 px in Chromium: the full icon stays crisp from 32 px up; at 16 px the thin crescent ring nearly vanishes, so use the favicon file below 64 px.
