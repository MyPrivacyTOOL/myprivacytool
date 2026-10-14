# Production validation checklist

Run before any Alice video ships. Copy this into the video's ticket, tick every line, and attach
three frame grabs (first, middle, last). One failed line blocks shipping.

Video id: ______  Library version used: ______  Reviewer: ______  Date: ______

## A. Assets
- [ ] Every Alice image/clip comes from a `locked` entry in `manifest.json` (list ids: ______)
- [ ] No 560 px legacy clip, no upscaled art, no new redraw, no text baked into Alice art
- [ ] `python3 tools/alice-library/validate_library.py` passes on the library used

## B. Look (compare to `faces/` and `poses/` side by side)
- [ ] Same face, hair, costume and shoes (no drift in hair length, eyes, apron, pocket side)
- [ ] Proportions within +/- 3% of the locked head-to-body ratio
- [ ] Palette: white and black only; the only colour is `#00FF00` code behind the curtain
- [ ] Pose is one of P1-P6 and matches MPC-7438
- [ ] Engraving line weight and hatching match; no smoothing, glow or colour

## C. Framing and motion
- [ ] 30 fps, correct canvas (1080x1920 or 1920x1080), white background
- [ ] Shot sizes and margins per `animation-production.md` section 2
- [ ] Blink, head, gesture and pause timings within spec; no banned movements
- [ ] Expressions used are from the expression map

## D. Voice
- [ ] Engine, voice id, speed, pitch and mastering exactly per `voice.md` (check render metadata)
- [ ] Loudness -18 LUFS +/- 1; no clipping
- [ ] Narration is the approved script word for word; claims on the approved list

## E. Consistency audit
- [ ] Place frame grabs next to the same pose from a previous shipped video (the most recent one,
      plus one chosen at random from earlier videos). Alice is visibly the same person.
- [ ] Voice compared against the `voice/` reference by ear: same voice, same pace
- [ ] Any deviation is written down and either fixed or approved as a version change

Result: PASS / FAIL.   Notes: ______
