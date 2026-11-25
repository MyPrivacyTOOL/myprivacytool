# MPC-9805 (EXT-18): accessibility, extensions/voices, reduced motion

STEP 0 on main 136b24b and the live site, 2026-11-18. Decision Q14 (Chris): soften the two /accessibility claims now; restore stronger wording only after the keyboard and screen-reader tests have run and are recorded.

## Run on the live site (GET only, desktop 1280x800, first visit, no consent given)
Tools: axe-core 4.10.2 injected through Playwright (rules wcag2a, wcag2aa, wcag21a, wcag21aa); a scripted Tab walk (70 presses per page); `prefers-reduced-motion` emulated.

| Page | axe violations | axe "incomplete" (needs a person) | Tab walk |
|---|---|---|---|
| / | 0 | 2 | 70 stops, focus ring on every one, no trap |
| /start | 0 | 2 | 69 stops, focus ring on all, no trap |
| /scan | 0 | 2 | 69 stops, focus ring on all, no trap |
| /scan/live | 0 | 2 | 69 stops, focus ring on all, no trap |
| /report | 0 | 2 | 69 stops, focus ring on all, no trap |

Limits of this evidence: automated tools find roughly a third of WCAG issues; the "incomplete" items (colour contrast over the animated background) need a human; the Tab walk shows order, visibility and traps, not that every function can be completed by keyboard; no screen reader was run. This is why the claims are softened, not removed.
On `/`, the first Tab stops are the hexagon buttons behind the full-screen device reveal, not controls on the reveal itself: to confirm by hand (follow-up).

## Items
| # | Item | Result |
|---|------|--------|
| 1 | Automated scan + keyboard pass on /, /start, /scan, /scan/live, /report | DONE, table above. 0 violations; two limits noted |
| 2 | Reduced motion on the home page | PARTIAL at HEAD: the matrix canvas stopped (MatrixRain.tsx) but 4 infinite animations kept running (3 hero "shadow hands" and a ping dot). Fixed in this PR (src/index.css): 0 infinite animations with reduced motion on, 8 unchanged with it off (checked on a local build) |
| 3 | Non-animated results view | STILL OPEN: MPC-10836 (shared with EXT-17, UX-020) |
| 4 | ACCESS-001 reword "can hint at a disability" | DONE: "Some of these are accessibility settings, so treat them as sensitive" (hexagons-366.json source, catalogue.js and public/footprint/hexagons-366.json regenerated with scripts/build-hexagon-catalogue.mjs). The Display-preferences hexagon is not built (status "new", access "Verify") |
| 5 | TECH-009 Extensions result wording | PARTIAL at HEAD: the registry text and guess band were already qualified, but the value said "N detected" / "Ad Blocker: Yes" and the risk text said extensions add to your fingerprint, while the code reads the browser's plug-in list and a decoy ad element. Now "N browser plug-ins listed" / "Ad blocker likely" and "websites cannot list your extensions this way, and neither can we". Still open: a failed decoy check counts as "ad blocker" (fingerprintDetection.ts catch block) and the registry confidence is a fixed 85: follow-up |
| 6 | Q14: soften "Full Keyboard Access" and "tested with NVDA, JAWS, VoiceOver, TalkBack" | DONE: "Keyboard use: we aim to ... not yet completed and recorded a keyboard-only test"; "We aim to support ... treat this list as our target, not as a result". Other unverified claims on the page (third-party audits, tagged PDFs, video captions, skip links): follow-up |
