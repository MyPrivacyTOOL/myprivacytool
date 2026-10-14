# Logo vectors (DRAFT v0.1)

Vector versions of the approved logo ("MyPrivacyTOOL.IO - Final Logo & Name - V.Final", locked
2026-06-20, Google Drive, raster PNG 2208x1242). **Status: draft, not approved by Chris.**

| File | Use |
|---|---|
| `mpt-logo-primary-black_v0.1-draft.svg` | black on light backgrounds (default) |
| `mpt-logo-reversed-white_v0.1-draft.svg` | white on dark or green backgrounds; no background rectangle |
| `mpt-logo-icon-black_v0.1-draft.svg` | mark only (figure in circle), for favicons and avatars |

## How they were made
Automatically traced from the approved PNG with `tools/brand/trace_logo.py` (numpy + Pillow, no
paid or online tools): threshold, marching squares, simplification, smoothed curves. Nothing was
redrawn or restyled. Reproduce: `python3 tools/brand/trace_logo.py logo.png out.svg full '#000000'`
(modes: `full`, `icon`).

## Known limits (a person should review before these are called final)
- Traced from a soft raster, so small corner details are slightly rounded compared with a hand-drawn vector.
- The wordmark is outlines, not live text. Its two typefaces (a serif for "MyPrivacy", a bold
  condensed sans for "TOOL.IO") are not yet identified.
- The logo reads "MyPrivacyTOOL.IO"; the brand name in text stays "MyPrivacyTOOL".
- Not yet checked at 16/32 px favicon size. Use the icon-only file below the 64 px minimum.
