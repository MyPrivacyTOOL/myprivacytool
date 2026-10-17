# Alice master character sheet

**Authority:** the approved Notion sheet MPC-7438 (approved by Chris 2026-10-12) is the source of
truth. This document turns it into a build spec and adds measurable detail; where they differ,
MPC-7438 wins and this file is corrected.

Style: 1865 Wonderland wood-engraving (Tenniel). Pen-and-ink line, cross-hatching for shade, no
colour fills. Palette: **white paper and black ink**. The only colour in any frame is Matrix green
(`#27AE60`) code on black behind the curtain, never on Alice herself.

Marked **[ref]** = read off the current reference (`video-scripts/assets/alice.png`, 820x736).
Marked **[proposed]** = a decision needing sign-off before v1.0; measure and replace with real
numbers from the final art.

## 1. Identity

- Young girl, about 7-10 years. Calm, attentive, curious. Never smirking, never glamorous.
- Always the same drawing family: one master artwork, derived views. No new faces drawn per video.

## 2. Face (views needed)

v1.0 requires front, three-quarter-left and profile-left only; the mirrored and remaining views follow in a minor version.

| View | Use | Min size |
|---|---|---|
| Front | talking to camera, thumbnails | 2048 px tall head crop |
| Three-quarter (left and right) | default narration | 2048 px |
| Profile (left and right) | curtain reveal, "looking at" shots | 2048 px |

Locked features **[ref]**: long wavy hair parted left of centre, falling past the shoulders with
a soft band at the crown; small straight nose; small closed mouth; eyes rendered as a single dark
iris with an upper lash line, no eyeshadow, no colour; light eyebrows, a thin single stroke.
Forbidden drift: hairstyle length, hair colour (always white/hatched), eye size, adult proportions,
shading style, any modern clothing or accessory.

## 3. Costume

- Puff-sleeved dress with a narrow fitted bodice **[ref]**; the sleeve ends in a small frill cuff.
- Full skirt with three horizontal tuck lines at the hem **[ref]**.
- White pinafore apron: wide bow at the back, a single patch pocket on the right side, scalloped
  hem, hatched shading on the lower fold **[ref]**.
- Striped stockings (MPC-7438) and black flat shoes with a strap **[ref]**. The reference drawing
  shows crosshatched dark stockings; confirm the stripe treatment with the artist.
- Costume never changes between videos. No seasonal variants.

## 4. Proportions (locked in v1.0)

MPC-7438 rule: head, limb length and body angle are identical across all poses (example given:
head is 1/7 of body height). Measured against head height H (crown to chin):

| Measure | Value | Status |
|---|---|---|
| Full height | 7.0 H | [provisional, from MPC-7438 example] |
| Hand length | 0.65 H | [proposed] |
| Eye line from crown | 0.45 H | [proposed] |
| Shoulder width | 1.4 H | [proposed] |
| Skirt hem from floor | 1.1 H | [proposed] |

The reference drawing leans forward, so measure on the final standing figure. Replace these with
measured numbers and set `proportions.status` to `measured` in `manifest.json`. Tolerance for any
later view: +/- 3%.

## 5. Pose library (full body), from MPC-7438

Three-quarter or profile, plain white background, same figure scale, feet on a common baseline.

| ID | MPC-7438 pose | Use |
|---|---|---|
| `p1-curious-ready` | leans forward, head tilted, one hand toward the curtain, slight smile | introducing the idea |
| `p2-observant` | bends slightly, gaze on a spot, one hand points or touches | looking at data |
| `p3-concerned` | straightens, hand on chest or raised, eyes slightly wide, no smile | naming the shadow |
| `p4-purposeful` | upright, one arm extended toward the next step, jaw set | showing the fix |
| `p5-inviting` | faces forward, both palms open, eye contact, slight smile | closing, call to action |
| `p6-behind-curtain` | angled to the white curtain, hand reaching for the fabric, head turned to camera | curtain setup |

Each pose ships as transparent PNG, long edge at least 3000 px (render also at 1920x1080 and
1080x1920 per MPC-7438), plus layered source (Alice / curtain / code on separate layers).
Poses are described, not yet rendered; see the artist brief (MPC-7401).

## 6. Expression sheet

Optional for v1.0 (later minor version). Head crops, three-quarter view, same lighting, one per pose mood: `curious`, `observant`,
`concerned`, `purposeful`, `inviting`, `anticipatory`. Mapping to motion is in
`animation-production.md`.

## 7. Source and rights

The master artwork must be original or properly licensed. The 1865 originals are public domain,
but any re-drawn or AI-generated derivative needs its licence/provenance recorded in
`manifest.json` (`provenance` field) before lock. Do not lock art whose origin is unrecorded.
