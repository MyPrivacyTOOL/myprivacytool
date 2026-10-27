# MPC-7471-F1: one scan-complete dialog

Status: LOCAL tests green, draft PR. Wording and screens need Chris's approval before merge. Not merged, not deployed.

## Behaviour
- Before: a congratulations banner (HexagonGrid, gone after about 5 s, with confetti) and, 1.5 s after the summary mounted, a second email dialog on top.
- After: one dialog (`EmailCaptureModal`, built on the project's Radix `ui/dialog`). It opens with the summary on genuine completion, with no timer, and stays until the visitor closes it (X, Escape, No thanks, backdrop) or submits. Closing it does not reopen it.
- Confetti: once, when the dialog opens, about 1.5 s, behind the dialog layer (z-index 40, overlay is 50). None for `prefers-reduced-motion`; the message is the same.
- Focus enters the dialog itself (not the email box, so a phone keyboard does not hide the message), Tab stays inside, focus returns to the element focused at completion.
- Form body, consent wording, unticked box, No thanks, unsubscribe line, Turnstile and the Worker call are unchanged. Only the `autoFocus` attribute on the email input was removed.

## Proposed wording (DRAFT, for Chris)
- Title: **You finished your scan**
- Line under it: **Here is what your browser showed us. Finishing a scan does not change any of it.**
- Then the result line (unchanged format), then the existing "Get your full privacy fix guide" block and form.

## Score mismatch: root cause
Two separate calculations, not stale state. The page card (`RiskScore.tsx`) is exposure-weighted with High >= 80 / Medium >= 50. The summary and modal (`FinalSummaryPanel.tsx`) were risk-weighted with a fingerprint bonus and High >= 70 / Medium >= 40. Decision (Chris, via the F1 session): the page score is canonical. Its code moved unchanged to `src/lib/scanResult.ts`; the page, the summary headline, the PDF export and the dialog all read it. No weights or thresholds were edited.
Consequences to know about: the summary/PDF headline number now equals the page number; per-category scores (MPC-7173 baseline) are unchanged; a baseline saved earlier as an overall score (for example 85) is not directly comparable to the new headline. "Exposure %" in the dialog is a different, labelled measure (confirmed / registry count).

## Not covered
- With `hex_v2` (honest tiles) on, the summary panel does not render, so no completion dialog opens. Off by default; needs a decision.
- Screenshots are synthetic runs of the production build with every non-local request aborted. They show no backend or email delivery.
- Timing reference: T0 = the moment the dialog became visible; shots at T0, T0+2 s, T0+10 s, each taken after asserting one dialog and an unchanged result.

## Coordination with F3 (MPC-7471-F3)
F1 owns the shell, header, open/close, confetti, a11y and the score contract. F3 owns the form/submit block, save tick box, scan reference and report pipeline. Props kept: `riskScore, categoryScores, confirmedCount, onClose, onSubmit`.

## Follow-up: honest-tiles mode (hex_v2)
With `hex_v2` on, the summary panel is not shown, so the dialog never opened. `TilesCompleteDialog` (lazy-loaded from `HexagonGrid`) now opens the same dialog when the scan completes in that mode: same header and form, and the result block is the counts-only risk profile ("N clear, N need fixing, N our guess, ..."). No score, percentage, "N of M", Low/Medium/High, coverage or score link, and **no confetti** (MPC-7916: finishing the taps is not a result; this is a choice Chris can reverse). Opens once, no timer, no auto-dismiss, not reopened after dismissal. Screenshots (synthetic, local production build with `?hex_v2=1`, dialog open / +2 s / +10 s, desktop and mobile): `docs/mpc-7471-f1/hex-v2/`.
New wording: only the "Your risk profile" label (already used on the page). Counts text is `riskProfileParts`, unchanged. Not changed: detection, scoring, consent, the form, report emails.
