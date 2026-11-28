# MPC-11622: Telegram exposure score launch pack (`exposure-tier-1`)

Status 2026-11-28: the score module is merged and deployed (PR 951). The new report text is **hidden**: it shows only when `TELEGRAM_EXPOSURE_DISPLAY="on"` on the social-listeners Worker, and that is not set. Baseline scan only acts for allow-listed test accounts (`PROBE_TELEGRAM_IDS`) unless `TELEGRAM_SCAN_SCOPE="all"` (not set), so the first people to see it are test accounts.
This file is what Chris needs to decide whether to flip it. Fixtures and the model: `docs/exposure-tier-1-telegram-fixtures.md`.

## 1. Checks done on the copy, and what is NOT done

Done (mechanical, asserted in `workers/social-listeners/exposure-report.vitest.ts`):
- No field that did not come back is called protected, clear, safe, fixed or hidden. The required sentence (rules page section 4) is present, word for word, after the "Not returned" lists it explains.
- Score and count side by side (`Telegram exposure 62 · 14 of 25 fields returned`); the count is unweighted and always there.
- Stacked bar as two labelled numbers (Always sent / Your settings) with the required note; position in the achievable range; no Low/Medium/High label (the web bands are not valid with a floor of 35).
- Fix list ordered by points recoverable, with the total (`27 points from 6 settings you can change`).
- The one sentence for the method change, with the old number shown as "previous method".
- Longest possible report with the flag on: 3,315 characters including the footprint hint (Telegram limit 4,096). Pinned by a test.
- Review of the first render found and fixed three defects before launch: the required sentence had no referent, the floor was stated twice, and "you can change" was doubled in the fix-list heading.

**Not done:**
- The swarm run on this copy. No swarm was run in this session.
- The **real-people check**. It needs real people and is Chris's. Nothing here claims it happened.

## 2. What users will see (rendered by the real code)

**P09: owner example: 14 returned** (the exposure block, which replaces the old "Telegram risk" header; the per-class lists follow unchanged, then the "Not returned" sentence)

```text
Telegram exposure 62 · 14 of 25 fields returned
▓▓▓▓▓▓▓▒▒▒▒▒········
Always sent: 35 of 100. This part is the platform, not your settings.
Your settings: 27 more. This part depends on settings you can change.
Exposure is the share of the risk in these 25 fields that reached this bot, each field weighted low 1, medium 2 or high 3. The count shows how many fields came back, unweighted. Telegram always sends 8 of the 25 fields.
Position: 42% of the range you can change (0% = nothing changeable is exposed, 100% = all of it is; the lowest possible score is 35).

27 points from 6 settings you can change. Biggest first:
  Birthday: 6 points
  Extra @usernames: 6 points
  Profile photo: 6 points
  Older profile photos: 6 points
  Emoji status: 2 points

Your number reads 62 now instead of 47% because the score now weighs each of 25 fields by how risky it is, where it used to count every field the same; nothing about your account changed (previous method: 14 of 30 = 47%).

[... per-class lists as today ...]

About "Not returned" above: This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.
```

**P08: unit-test profile (baseline-scan.vitest.ts CHAT)** (the exposure block, which replaces the old "Telegram risk" header; the per-class lists follow unchanged, then the "Not returned" sentence)

```text
Telegram exposure 48 · 11 of 25 fields returned
▓▓▓▓▓▓▒▒▒▒··········
Always sent: 29 of 100. This part is the platform, not your settings.
Your settings: 19 more. This part depends on settings you can change.
Exposure is the share of the risk in these 25 fields that reached this bot, each field weighted low 1, medium 2 or high 3. The count shows how many fields came back, unweighted. Telegram always sends 8 of the 25 fields.
Position: 20% of the range you can change (0% = nothing changeable is exposed, 100% = all of it is; the lowest possible score is 35).

19 points from 4 settings you can change. Biggest first:
  Birthday: 6 points
  Profile photo: 6 points
  Bio: 4 points
  Photo fingerprint: 4 points

Your number reads 48 now instead of 37% because the score now weighs each of 25 fields by how risky it is, where it used to count every field the same; nothing about your account changed (previous method: 11 of 30 = 37%).

[... per-class lists as today ...]

About "Not returned" above: This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.
```

**P01: all-off** (the exposure block, which replaces the old "Telegram risk" header; the per-class lists follow unchanged, then the "Not returned" sentence)

```text
Telegram exposure 35 · 8 of 25 fields returned
▓▓▓▓▓▓▓·············
Always sent: 35 of 100. This part is the platform, not your settings.
Your settings: 0 more. This part depends on settings you can change.
Exposure is the share of the risk in these 25 fields that reached this bot, each field weighted low 1, medium 2 or high 3. The count shows how many fields came back, unweighted. Telegram always sends 8 of the 25 fields.
Position: 0% of the range you can change (0% = nothing changeable is exposed, 100% = all of it is; the lowest possible score is 35).

Nothing you can change came back in this check.

Your number reads 35 now instead of 27% because the score now weighs each of 25 fields by how risky it is, where it used to count every field the same; nothing about your account changed (previous method: 8 of 30 = 27%).

[... per-class lists as today ...]

About "Not returned" above: This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.
```

## 3. Flip runbook (Chris only: production switch, held)

Preconditions: the real-people check is recorded; the wording in section 5 is approved (or replaced); the decisions in section 6 are made.

The change is one line in `workers/social-listeners/wrangler.toml`, in `[vars]`, after `TELEGRAM_FIX_WIZARD = "on"`:

```toml
# MPC-11622: show the tier-weighted exposure score (exposure-tier-1) in the baseline report. Only acts for senders in PROBE_TELEGRAM_IDS unless TELEGRAM_SCAN_SCOPE="all" (not set).
# Rollback: set "off" (or delete this line) and deploy. report.exposure is stored either way.
TELEGRAM_EXPOSURE_DISPLAY = "on"
```

Open it as a PR, add the PR to `docs/HELD_PRS.md`, and merge only on Chris's word. After the deploy, send "scan me" from an allow-listed account and check the report starts with `Telegram exposure`. Rollback: revert that PR.

## 4. Fix wizard and re-check are unchanged

`RISK_VERSION` is still `risk-count-1`, so existing baselines stay comparable with re-checks. The Changes indicator (`3 of 4 settings changed`) is built (`telegramChanges`) but **not shown in the bot yet**; wiring it into the re-check message is a follow-up and needs its own copy review.

## 5. Proposed wording for "how the Telegram score works" (DRAFT, needs Chris; not published)

The approved web page (`/how-we-calculate-your-score`, `src/pages/ScoreMethod.tsx`) is category-weighted and any change to it needs Chris, so nothing was edited there. Proposed text for a Telegram section or page:

> **Your Telegram exposure score.** Telegram tells a bot about 25 things about you. We give each one a risk level: low counts 1, medium 2, high 3. Your exposure is the weight of the things that reached the bot, as a share of the weight of all 25, so the same settings always give the same number. Next to it we always show how many of the 25 came back, with no weighting, so you can check us.
> Eight of the 25 are sent with every message, whatever you do. That part is Telegram's, not your settings, and it is why the lowest possible score is 35, not 0. The other 17 depend on your privacy settings.
> A field that did not come back may be hidden by your settings, or may be one you never filled in. One scan cannot tell which, so we never call it protected or safe. We only say a setting changed when a later scan sees it change.
> Telegram's number is only for Telegram. It is not comparable with a web or email number, and we never add or rank them.

## 6. Decision needed: two implementations of the same rules now exist

PR 950 (MPC-11569, another session) merged `shared/hexagon-registry/scoreV3.js`, `exposure-v3`: the same rules for **web (47 fields) and email (6)**, built as a library and not wired to anything. `shared/exposure/` (this work) is the same rules for **Telegram (25)**, built so any channel plugs in with `defineChannel()`. The brief said web, email and WhatsApp must share one codebase. Today they do not. They agree on the formula, tiers, fixed denominator, rounding, the required wording and the stack labels. They differ here:

| | `scoreV3.js` (web, email) | `shared/exposure` (Telegram) |
|---|---|---|
| Adding a channel | edit and regenerate `scopeV3.js` | `defineChannel({...})` |
| Position in range | share of the changeable weight that came back | `(exposure - floor) / (100 - floor)`, as written in the brief |
| Same profile P08 (no last name) | 29% | 20% |
| Same profile P09 | 41% | 42% |
| Fix-list points | tier share to one decimal, not re-scored | exact drop of the rounded score, whole numbers |
| Field not observed (check failed) | counts 0; no score only if nothing was evaluated | no score (incomplete) |
| Band | `band_proposal`, flagged uncalibrated | none |
| Version label | `exposure-v3` | `exposure-tier-1` |

The two position definitions are equal whenever every always-sent field came back. They differ for an account missing one (for example no last name), where the literal formula can read below the floor and has to clamp. The changeable-share form needs no clamp and means exactly "0% = nothing changeable is exposed".

**Recommendation (one Y):** make `shared/exposure` the only implementation. Move `scoreV3` to be a thin adapter that registers web and email with `defineChannel()` and keeps its output shape and tests. Use one definition of position (the changeable share), one fix-list rule (the exact drop), one label (`exposure-v3`, since the web docs and baseline gating already use it), and a per-channel setting for how a not-observed field counts (`zero` for web and email, `incomplete` for Telegram). Nothing user-visible consumes either library yet, so doing it now changes no number anyone has seen. It is a separate PR and a separate review, and it should not start while the MPC-11569 session is still working on that file.

## 7. Still open

1. The consolidation above.
2. A calibrated Telegram band, once real scores have been seen. Until then position only.
3. Web headline: `exposure-v1`/`v2` are still category-weighted and are what web shows today. Making the tier-weighted score the web headline is the MPC-11569 flip, held for Chris.
4. The cross-channel wording (rules page section 10) must be in product copy before any multi-channel view ships.
