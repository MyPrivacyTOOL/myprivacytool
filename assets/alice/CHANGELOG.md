# Alice library changelog

## 0.1.0-draft (MPC-7797)
- Added specs: character sheet, animation and production, voice, validation checklist.
- Added `manifest.json` listing every required asset (all art still missing).
- Registered the existing 820 px reference `video-scripts/assets/alice.png` as the interim reference.
- Voice, frame rate and canvas recorded from the shipped video pipeline (MPC-7415 / MPC-7411).
- NOT locked. v1.0.0 needs the missing art, the human sign-offs in the manifest `open_decisions`, and a clean validator run.
- Sign-off (MPC-7797): framing rules, 16:9 canvas, motion timings and the voice choice approved as v1 working values; proportions approved as provisional pending measurement. Remaining open items are in `manifest.json`.

## 0.1.1-draft (MPC-7797)
- Aligned with the approved MPC-7438 sheet: poses P1-P6, striped stockings, `#00FF00` code colour,
  curtain reveal 0.5-1.5 s, expressions per pose mood, 7-head proportion target (provisional).
- Voice licence recorded from MPC-7438 (Apache 2.0, commercial use permitted); approved sample added as the voice reference.

## 0.1.2-draft (MPC-7797)
- v1.0 scope reduced (approved): six poses P1-P6, layered master, three head views (front, three-quarter-left, profile-left) and the voice reference. Remaining faces, the six expression crops and the curtain-reveal animation are optional, for later minor versions.

## 0.1.3-draft (MPC-7797)
- Code colour corrected from `#00FF00` to Matrix Green `#27AE60` (locked brand palette; `#00FF00` was never approved as a hex). Matches the corrected MPC-7438.
