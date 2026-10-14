# Alice master character sheet

Style: 1865 Wonderland wood-engraving (Tenniel). Pen-and-ink line, cross-hatching for shade, no
colour fills. Palette: **white paper, black ink, brand green (`#2EA05A`) only**, and green appears
only in the code curtain / UI accents, never on Alice herself.

Marked **[ref]** = read off the current reference (`video-scripts/assets/alice.png`, 820x736).
Marked **[proposed]** = a decision needing sign-off before v1.0; measure and replace with real
numbers from the final art.

## 1. Identity

- Young girl, about 7-10 years. Calm, attentive, curious. Never smirking, never glamorous.
- Always the same drawing family: one master artwork, derived views. No new faces drawn per video.

## 2. Face (views needed)

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
- Black flat Mary Jane style shoes with a strap; dark stockings/leggings crosshatched **[ref]**.
- Costume never changes between videos. No seasonal variants.

## 4. Proportions (locked in v1.0)

Measured against head height H (crown to chin):

| Measure | Value | Status |
|---|---|---|
| Full height | 6.0 H | [proposed] |
| Hand length | 0.65 H | [proposed] |
| Eye line from crown | 0.45 H | [proposed] |
| Shoulder width | 1.4 H | [proposed] |
| Skirt hem from floor | 1.1 H | [proposed] |

The final art is measured once, these numbers replaced by the measured ones, and the
validator's `proportions` block in `manifest.json` updated. Tolerance for any later view: +/- 3%.

## 5. Pose library (full body)

All poses use the same figure scale. Transparent background, feet on a common baseline.

| ID | Pose | Notes |
|---|---|---|
| `standing-neutral` | standing, hands relaxed | default idle, anchor for all views |
| `curtain-pull` | leaning, drawing curtain aside | the existing reference **[ref]**; brand hero pose |
| `gesture-open` | one hand open toward viewer | explaining |
| `pointing` | arm extended, pointing at on-screen text | calls to action |
| `thinking` | hand to chin, head slightly tilted | questions, "consider this" |
| `surprised` | step back, hands raised, eyes wide | scam reveals, breach news |

Each pose ships as transparent PNG, long edge at least 3000 px, plus layered source
(Alice / curtain / code kept on separate layers so the curtain animation can be built).

## 6. Expression sheet

Head crops, three-quarter view, same lighting. Full mapping to animation in
`animation-production.md`.

`neutral`, `curious`, `concerned`, `surprised`, `warm-smile`, `thinking`, `reassuring`.

## 7. Source and rights

The master artwork must be original or properly licensed. The 1865 originals are public domain,
but any re-drawn or AI-generated derivative needs its licence/provenance recorded in
`manifest.json` (`provenance` field) before lock. Do not lock art whose origin is unrecorded.
