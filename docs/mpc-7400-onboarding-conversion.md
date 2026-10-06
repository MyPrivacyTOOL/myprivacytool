# MPC-7400: User onboarding flow and conversion optimisation

FLEET-TASK-V4.2 summary. Repo: MyPrivacyTOOL/myprivacytool, branch `claude/eager-shannon-obkyg7`, env: prod (Cloudflare Pages).

## Goal
Visitors who start a signup or contact form finish it with less friction, get clear feedback, and land on a Thank You page that tells them what happens next and where to go. Conversion is measurable per variant.

## Scope
In: `/start`, `/ai-access-check`, `/contact` form UX; new `/thank-you`; client-side A/B framework; GA4 events; welcome-email workflow spec.
Out (untouched): OAuth (MPC-6971), legal pages (MPC-6545), performance (MPC-7200), developer docs (MPC-7250), tests/security work (MPC-7300/7350), Supabase cutover (blocked by MPC-6950), `/business`, newsletter embed, HubSpot form IDs and `source_tag` values.

## Audit: journey before this change
| Step | Friction found | Fix |
|---|---|---|
| Email field | Native browser validation bubble, no inline message, no typo help | Inline validation on blur/submit, `aria-invalid`, focus on first bad field, "Did you mean gmail.com?" hint |
| Consent box | Native `required` tooltip only | Visible message next to the box |
| Submit | Button text swap only; double click possible | Spinner, check on success, locked while sending; double submits ignored |
| Errors | Raw `Failed to fetch` / `HubSpot error 500` shown | Plain-English messages, input kept |
| After submit | `/start` and `/ai-access-check` showed a small inline note; `/contact` inline "Message sent"; no next steps | Redirect to `/thank-you?source=...` with next steps and trust links |
| `/start` copy | Promised a "full privacy report" and automatic broker removal that nothing delivers | Replaced with truthful wording (see Open questions) |
| Home page | No signup CTA above the fold (hexagon grid is the CTA) | Not changed: out of scope, no new features |

Not changed, flagged: `/business` promises "within 48 hours" (MPC-6977 follow-up D); `/start` hexagon rows show static placeholder values labelled as detected ("Estimated 40+ sites").

## Acceptance criteria
- [x] Invalid email or missing consent never reaches HubSpot and shows an inline message (`src/pages/Start.test.tsx`).
- [x] A valid submit calls HubSpot once, fires `generate_lead` once, then lands on `/thank-you` (tested).
- [x] A failed submit keeps the input and shows a plain-English error (tested).
- [x] `/thank-you` is noindex, absent from the sitemap, links to scan, opt-out guides, FAQ, privacy, cookies, terms, about (tested; build verified).
- [x] A/B framework: weighted pick, per-tab-session stickiness, QA override, off-by-default flag, no cookies (`src/lib/abTest.test.ts`).
- [x] `npm test` (22 pass), `tsc`, `npm run build` pass; no new lint problems (40 before, 40 after).
- [ ] HubSpot welcome workflow created and live-tested: **not done** (connector cannot create workflows, send or test; see `docs/welcome-email-mpc-7400.md`).
- [ ] Live verification after deploy (HubSpot contact, GA4 DebugView): needs a human.

## Rollback plan
Revert the PR (single squash commit). No data migration, secrets or worker changes. Cloudflare Pages redeploys the previous build in about two minutes. To pause only the experiment, leave `VITE_AB_START_CTA_ENABLED` unset. To hide the "welcome email" line, leave `VITE_WELCOME_EMAIL_LIVE` unset.

## Expected impact (hypotheses, not measured)
Inline validation and clearer errors typically cut form abandonment on errors; the Thank You page raises scan starts from signups. Targets to confirm in GA4 after 14 days: signup completion (view of form to `generate_lead`) up, `form_validation_error` per submit trending down, `thank_you_next_step_click` on at least 25% of `thank_you_view`. No baseline exists yet, so no numeric uplift is claimed.

## Open questions for Chris
1. Approve the variant copy "Get early access, free" before enabling `VITE_AB_START_CTA_ENABLED=true`.
2. The `/start` copy edits overlap MPC-6977 follow-up D (delegated to MyPrivacyToolClaw). Keep them, or let that task own them?
3. HubSpot: build the welcome workflow (spec in `docs/welcome-email-mpc-7400.md`), then set `VITE_WELCOME_EMAIL_LIVE=true`.
4. Developer docs and Trust centre links now point at the on-site `/developers` and `/trust` pages (MPC-7250 / MPC-6545).
