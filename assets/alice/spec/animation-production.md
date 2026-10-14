# Alice animation and production spec

**[shipped]** = what the pipeline does today (`tools/video-pipeline/build_short.py`).
**[proposed]** = needs sign-off.

## 1. Canvas and timing

| Item | Value | Status |
|---|---|---|
| Frame rate | **30 fps** constant, never mixed | [shipped] |
| Vertical (Shorts/Reels/TikTok) | 1080 x 1920, 9:16 | [shipped] |
| Horizontal (YouTube) | 1920 x 1080, 16:9 | [proposed] |
| Thumbnail | 1280 x 720 | [shipped] |
| Background | pure white `#FFFFFF` | [shipped] |
| Codec | H.264 MP4, yuv420p, AAC audio | [proposed] |
| Loudness | -18 LUFS (voice) | [shipped] |

30 fps is chosen over 24 because every shipped video already uses it and captions are timed to it.

## 2. Camera framing (pixel rules)

Alice's full height at 1080x1920 is currently scaled to fit `min((1080-120)/w, (bottom-top)/h)`.
Rules below fix this so every video frames her identically. Heights are measured on the visible
figure, in pixels, at the 9:16 canvas; for 16:9 scale by 1080/1920.

| Shot | Visible figure | Alice height | Placement | Status |
|---|---|---|---|---|
| Full | whole body incl. shoes | 1100 px | feet baseline at y = 1480, centred x | [proposed] |
| Medium | head to hip (waist-up crop) | 1100 px of the figure shown, so about 1.9x scale | eye line at y = 520 | [proposed] |
| Close | head and shoulders | head 560 px | eye line at y = 700 | [proposed] |

Margins: at least 60 px (shipped, `W-120`) side margin; nothing important in the bottom 380 px
(platform UI) or top 200 px. Captions: Inter Bold, white outline, 7 words max per chunk **[shipped]**.
One shot size per beat; no zoom between sizes inside a beat.

Camera move: slow zoom, 1.00 to 1.06 over the beat, slight horizontal drift **[shipped]**. No rotation,
no shake, no whip.

## 3. Movement guidelines

- **Blink**: every 3.5 s on average (range 2.5-5 s), 6 frames closed-to-open (0.2 s). Double blink
  at most once per 20 s. **[proposed]**
- **Breathing / idle**: 0.5 px-equivalent vertical sway (about 0.3% of figure height), 4 s cycle.
- **Head**: tilt max 8 degrees; turn changes take at least 12 frames (0.4 s), ease in/out.
- **Gestures**: 18-24 frames (0.6-0.8 s) up, hold 12 frames, 18 frames back. One gesture per
  sentence at most; return to neutral between.
- **Pauses**: 0.3 s between beats **[shipped]**; 0.2 s lead-in, 0.4 s tail **[shipped]**; allow a
  0.5 s beat after a question.
- **Never**: speed ramps, bounce, cartoon squash and stretch, mouth flap not matched to audio.

Lip-sync is not used in v1; Alice speaks as a voice-over with micro-movement only. If lip-sync is
added, it is a MINOR version and needs its own viseme sheet.

## 4. Expression mapping

One expression per MPC-7438 pose mood. Fine values are proposed.

| Expression (pose) | Brows | Eyes | Mouth | Head |
|---|---|---|---|---|
| curious (P1) | one brow raised 2 px of head height | open, alert | slight smile | tilt 6 degrees toward raised brow |
| observant (P2) | level, slightly lowered | focused on a spot, gaze down | closed, flat | tilt 4 degrees down |
| concerned (P3) | inner ends up | slightly wide, +10% | closed, no smile | straight, still |
| purposeful (P4) | level, firm | forward, steady | closed, jaw set | straight |
| inviting (P5) | softly raised | meeting the viewer | slight smile | tilt 3 degrees |
| anticipatory (P6) | relaxed | toward the curtain then camera | closed, slight hold | turn toward camera, 12 frames |

Hold each expression at least 0.5 s; transitions 6-9 frames. No fear expressions: Alice informs,
she does not alarm (brand no-fear rule).

## 4a. Curtain and code reveal (MPC-7438 deliverable 4)

- Reveal takes 0.5 to 1.5 s (15-45 frames at 30 fps), eased, never jerky.
- Curtain: white, line-drawn folds in the engraving style. Behind it: black, then green code
  (`#00FF00`), large and readable on mobile, 40-60% fill, monospace, swirling or cascading
  gracefully, never chaotic.
- Every curtain moment uses the same folds, code colour and motion speed in every video.
- Fix scene: curtain closes or code fades, replaced by an action element (button, letter, door).

## 5. Layer and file structure for animation

Master art is layered: `alice` / `curtain` / `code` (Matrix green `#00FF00` characters on black) / `background`.
The curtain-reveal animation needs these separate (known gap in `tools/video-pipeline/README.md`).
Source: layered PSD or SVG. Delivery: PNG sequence or ProRes 4444 with alpha, then MP4 via ffmpeg.

## 6. AI video generation (if used)

Image-to-video only, anchored on a locked still; describe motion only, never appearance. Follow
`docs/kling-ai-prompt-engineering-guidelines.md`. Every generated clip goes through
`validation-checklist.md`; drift means reject, not fix in post.
