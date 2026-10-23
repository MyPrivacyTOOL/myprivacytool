# MPC-8452 design note: live thank-you page

**Status: DRAFT for owner approval. Nothing is built.** All visitor-facing copy below is a proposal and needs Chris's sign-off before it ships (swarm run and real-people check, per the ticket). Lines marked **[approved]** already exist in the codebase; everything else is **[proposed]**.

Notion ticket: https://app.notion.com/p/40228547eaa781c4874ed5b7c0e4f2df

## 1. What exists today (read from the repo)

- The "thank-you" is one box in `src/pages/Scan.tsx` (`thanks`, role="status"): "Thanks, we have your email." plus the address and `ScanNumberNotice`. It shows after `POST /api/scan` succeeds.
- `POST /api/scan` (`src/lib/scanReport.ts`, Worker `workers/scan-report`) returns nothing the page can show. The report is built in the Worker and emailed. There is **no endpoint that streams or polls findings**. Only `/api/web-scan/step` exists, and it is write-only funnel timing.
- The browser scan result is kept in `sessionStorage` (`rememberCompletedScan`) **only when saving is on** (`VITE_SAVE_WEB_SCANS`), and only until the contact step. A visitor who arrives on `/scan` directly has no scan.
- Hexagons: `shared/hexagon-registry` (54 web hexagons plus 4 email hexagons) and its FOUND / CHECKED AND CLEAR / NOT CHECKED rule (`status.js`). `trust_score` is deliberately null; this design shows no score.
- The four email hexagons (`email-breaches`, `email-name`, `email-provider`, `email-profile`) run in the Worker when the report is prepared. `email-breaches` is **not built** (terms unconfirmed, `docs/email-hexagons-mpc-7467.md`).
- Curtain reveal already exists on `/footprint/` (`public/footprint/index.html`, settings in `curtain.json`, doc `docs/footprint-curtain.md`). Reuse its approach, not its code path.
- Alice: locked spec in `assets/alice/`, voice rules in `assets/alice/spec/voice.md`, approved character sheet MPC-7438. Expression plates are in `assets/branding/alice-mpc-7795/` (flat rasters, not locked, "unchecked against the Brand Bible"). Voice: warm, clear, unhurried, plain words, no jargon, no alarm, no sales voice, short sentences, British spelling. Claims must be on the approved claims list (MPC-7402).

## 2. The decision that shapes everything (owner to choose)

"Findings arrive live" needs a real source. Honest options:

| Option | What the visitor sees | Needs | Risk |
|---|---|---|---|
| **A. Replay the finished browser scan** (recommended first) | Hexagons from the scan they already ran fill in one by one. Nothing new is checked; Alice says so. | Scan kept in sessionStorage for this visit; works without a new endpoint. | Only for visitors who ran the scan first. Others get state S2-no-scan. |
| **B. Live email checks** | The 4 email hexagons fill as the Worker finishes them. | New read endpoint (or the `/api/scan` response) returning per-hexagon status; no email content in URLs; breach check still unbuilt so that hexagon stays NOT CHECKED. | New server surface, privacy review (address or its hash reaches Cloudflare DoH and Gravatar already, `docs/email-hexagons-mpc-7467.md`). |
| **C. A then B** | Browser hexagons first, then email hexagons, then the report section. | Both. | Largest build. |

Recommendation: ship **A** first (no new data leaves the browser), design the states so **B** drops in without a rewrite.

## 3. Screens and states

One page (`/scan`), one column on mobile, hexagons below the thank-you. The page never navigates; state changes in place.

| # | State | What shows | Exit |
|---|---|---|---|
| S0 | Form (today) | Unchanged. | Submit succeeds. |
| S1 | Thanks | Existing thank-you box stays exactly as is (heading, address, scan number). Under it, a still frame of Alice behind a closed curtain. | After the box is announced, the curtain begins to open. |
| S2 | Curtain reveal | Image fades in slowly from behind the curtain (about 4 s). Reduced motion: image simply present, no animation. | Reveal ends. |
| S2-no-scan | No scan in this browser | Alice: offers the free scan (link to `/`), no hexagons shown, no empty grid. Report email still on its way. | Visitor leaves or taps the link. |
| S3 | Hexagons fill | Grid of hexagons, all starting **"waiting"** (neutral outline, no colour meaning). They resolve one at a time, in registry order, about 150 ms apart, each to FOUND, CHECKED AND CLEAR or NOT CHECKED, using the existing tile styles. | All resolved. |
| S4 | Report section builds | Under the grid: a plain summary using the existing counts (`SUMMARY_LABELS`: clear, need fixing, you told us, not checked yet), then "your report is in your inbox" with the address. | Static end state. |
| S5 | Left early | Nothing to do on the page. The Worker already sends the emailed report; this design does not touch that pipeline. | n/a |
| S6 | Error or offline | Existing error and retry behaviour for the form is unchanged. If the grid cannot load, Alice says the report is still coming and the page stops. | n/a |

Rules for every state:
- A hexagon never shows a value, colour or count until it has an actual status from the registry rule. "Waiting" is not a finding.
- The summary counts only resolved hexagons. NOT CHECKED is shown as "not checked", never folded into "clear".
- There is no score and no percentage anywhere (registry `trust_score` is null).
- Finished state is the same whether the visitor stayed for all of it or opened the page late.

## 4. Alice: lines (all [proposed] unless marked; Chris signs off)

Voice: short, one idea each, British spelling, no alarm. Spoken-length lines can double as on-screen captions. She narrates; she never states a finding the grid has not resolved.

| When | Line | Source |
|---|---|---|
| S1 | "Thank you. Your report is on its way to your inbox." | proposed |
| S2 | "Let me draw back the curtain." | proposed |
| S3 start | "I'll show you what your browser told every website, and how we know each thing." | proposed, adapted from approved `ALICE_TILES_INTRO` |
| S3 per hexagon | Uses the existing tile text from `aliceTileMessage()` for that hexagon; no new per-hexagon copy. | [approved] |
| S3 halfway | "Some of these say they weren't checked. For those I make no claim, and I won't guess." | adapted from [approved] `ALICE_TILES_NEXT` |
| S4 | "That's everything I checked. The full report is in your inbox, with what to change first." | proposed |
| S2-no-scan | "You haven't run the free scan in this browser yet. Your report email is still coming. Want me to show you?" | proposed |
| S6 | "I couldn't show that here. Your report is still on its way." | proposed |
| Reduced motion | Same lines, shown instantly. | proposed |

Image: use a plate from `assets/branding/alice-mpc-7795/` (candidates: `alice-presenting`, `alice-curious`) or the existing `alice-curtain.jpg`. **Open:** these plates are not locked and are unchecked against the Brand Bible; owner to pick or approve. Per `assets/alice/README.md`, do not redraw or restyle her.

## 5. Motion rules

- Reveal: opacity 0 to 1 over 4 s, ease-out, with the curtain element sliding off (`left`, 1.3 s, as `curtain.json`). Hexagon stagger about 150 ms. Nothing loops. Nothing flashes.
- `prefers-reduced-motion: reduce`: no fade, no slide, no stagger. Final state appears at once; Alice's lines appear as static text. Meaning never relies on motion alone.
- Total animation under about 12 s for the full 54-hexagon grid on a mid-range phone; if the tab is hidden, jump to the end state.
- Animate only `opacity` and `transform`. No autoplay audio or video (voice playback, if offered later, is tap to play).

## 6. Privacy and access

- No personal data in URLs: no email, scan number or findings in the query string or hash. The page stays at `/scan`.
- No third-party scripts added. The existing Turnstile and analytics behaviour is unchanged. Images self-hosted.
- The live view shows only what the visitor's own consented scan produced. With save off (today's default), option A must not write new storage; it reads what the browser already holds for this visit. Decision needed: `rememberCompletedScan` currently does nothing unless saving is on, so option A needs either that flag on or a narrow sessionStorage hand-off that is cleared on use. **Owner to decide.**
- If option B is chosen: the new endpoint takes an opaque, short-lived token (not the address), returns hexagon ids and statuses only, is rate limited, and gets a privacy-policy line (MPC-7470).

## 7. Accessibility

- One `aria-live="polite"` region announces Alice's lines and a single "N of 54 checked" update every few seconds, not one announcement per hexagon.
- Hexagons are focusable only once resolved; each has a text label with its status (word, not colour only). Tap a hexagon shows detail, as today.
- Alice's image has descriptive alt text; decorative frames are `alt=""`.
- Mobile first: single column, 44 px minimum targets, no hover-only information, readable at 320 px.
- Keyboard: no focus trap; focus stays on the thank-you box when the page updates.

## 8. Analytics

Reuse existing events through `src/lib/analytics.ts`: add only counts (reveal seen, grid completed, left early), no findings or address.

## 9. Approvals needed before build

1. Option A, B or C (section 2) and the storage decision (section 6).
2. Chris: all [proposed] Alice lines and the thank-you/summary copy.
3. Owner: which Alice image (section 4).
4. Whether the 54-hexagon grid is right on a phone or a short "top findings" view replaces it.

## 10. Build plan after approval

1. Presentational components with fixtures (curtain, hexagon stagger, Alice captions) and tests for reduced motion and the honesty rule (no value before status).
2. Wire to the chosen data source behind a feature flag, default off.
3. Playwright e2e at 375 px and with `reducedMotion: 'reduce'`.
4. Owner and Chris review on a preview deploy, then flag on.
