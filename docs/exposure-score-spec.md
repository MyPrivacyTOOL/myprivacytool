# Exposure score, bands and coverage: specification `exposure-v1` (MPC-7471-F4)

Status: **DRAFT PR, not merged, not deployed.** Chris approved four concepts (D-a to D-d, 2026-10-13, recorded in the task's Approval_Notes). He has **not** approved the weights, the severity map, the registry mapping or the public wording. Those are listed under "Decision register" and are marked PROPOSED in the code.

Code: `shared/hexagon-registry/score.js` (types `score.d.ts`, tests `score.test.mjs`). The page reaches it through `src/lib/exposureScore.ts`. Nothing in this change alters what the scan detects.

## 1. What the number means (D-a, approved)

The **exposure score** says how much your browser reveals, weighted by how sensitive each item is. It is **not** a probability of harm, not a measure of how safe you are, and not a comparison with other people.

## 2. The definition

Each registry hexagon has a category, a severity and, per scan, a status: `found`, `clear` or `not_checked`.

```
E_g = 100 x sum(severity of FOUND items in g) / sum(severity of CHECKED items in g)     CHECKED = found or clear
S   = round_half_up( sum(w_g x E_g) / sum(w_g) )      over categories with at least one checked item
C   = round_half_up( 100 x checked / Z )              Z = the true registry total
band(S) = Low if S <= 39, Medium if S <= 69, High otherwise      (D-b, approved)
```

* All arithmetic is exact: weights are whole percent, sums are integers, the division is done with `BigInt` fractions and half-up rounding is integer arithmetic. No floating point is involved, so `.5` always rounds up, and the result does not depend on item order.
* The band is decided on the **rounded whole number** (39.5 rounds to 40 and is Medium).
* **Not-checked** items are left out of S and lower C; they are neither clear nor found (D-d, approved). A category with no checked item is skipped and the remaining weights renormalise.
* **Nothing checked means no score** (`score: null`, `band: null`, status `no_checked_items`). It is never shown as 0 or Low. All checked and all clear is a real 0 (Low).
* Every result carries `score_version: "exposure-v1"` and `provisional` (true unless the caller says the scan is final).

### Handling of bad input (deterministic, independent of item order)

| Input | Result |
|---|---|
| unknown hexagon id, or a status other than found / clear / not_checked | rejected, listed in `rejected`, not counted at all |
| same id twice, same status | counted once |
| same id twice, different statuses | **not checked**, listed as `conflicting_status` |
| `found` or `clear` for a hexagon the registry says the site can never check | demoted to not checked (`cannot_be_checked`) |
| `clear` where the registry does not allow CHECKED AND CLEAR | demoted to not checked (`clear_not_allowed`) |
| `total` (Z) not a positive whole number | throws |
| checked greater than Z | coverage capped at 100, warning `checked_exceeds_total` |

"Returned a harmless value" is **not** mapped to found here: the status comes from the registry rules in `status.js` (`captureStatus`), which already turn placeholders and "nothing seen" values into not checked. This contract only reads the status.

## 3. Tables (all PROPOSED, in code as the single copy)

Weights, whole percent, sum exactly 100: device 5, privacy 5, language 5, orientation 5, fingerprint 25, storage 10, social 20, security 15, behavior 10. These are the figures both old formulas already used.

Registry `category` to weight category: device and network to **device**; privacy and profile to **privacy**; the other seven map to themselves.

Severity from registry `truth.sensitivity`: low 1, medium 2, high 3. **The registry has only three levels and no 4-level "risk level"**, so the task text's `{1,2,3,4}` cannot be read from it (`truth.risk` is free text).

Structure of the registry today (54 hexagons, 41 always present and 13 conditional):

| category | items | can ever be clear | site cannot check | total severity | weight |
|---|---|---|---|---|---|
| device | 8 | 0 | 0 | 10 | 5 |
| privacy | 4 | 0 | 0 | 7 | 5 |
| language | 3 | 0 | 0 | 4 | 5 |
| orientation | 5 | 0 | 0 | 5 | 5 |
| fingerprint | 12 | 0 | 0 | 18 | 25 |
| storage | 5 | 3 | 0 | 5 | 10 |
| social | 5 | 0 | **5** | 10 | 20 |
| security | 6 | 2 | **2** | 8 | 15 |
| behavior | 6 | 0 | 0 | 6 | 10 |

## 4. Decision register

**Approved (Approval_Notes, 2026-10-13; no later amendment exists, the Amendments field is empty):** D-a meaning, D-b bands 0-39 / 40-69 / 70-100 as one constant, D-c "exposure %" renamed coverage = checked / true total Z, D-d not-checked excluded from the score and counted against coverage. Chris also still approves the final "How we calculate your score" wording before merge.

**Not decided (needs Chris), found by reading the registry and running the formula:**

* **O-1. On a complete scan the score cannot be low.** Only 5 of 54 hexagons can ever be clear. In the other six categories a checked item is necessarily found, so its exposure is 100. A scan that checked everything the site can check scores **at least 83** even if all five clearable items are clear (test: `KNOWN LIMITATION`). In a simulation of 5000 random scans, 4999 were High. This follows from D-a and D-d plus the registry's rule that an informational item can only be found or not checked. It is not a coding choice. Options: (a) accept: "everyone reveals a lot", Low only on partial scans; (b) give informational items value-specific severities, a registry change owned by MPC-7466; (c) change weights; (d) change the bands. The old formulas (78% Medium on the page, 85/100 High in the popup) had the same pressure.
* **O-2. The 20% Social weight and 2 of 6 Security items can never be scored** on the web scan (registry level `cannot_be_checked`). Social is always skipped, so the effective weights are renormalised (a complete scan uses 80 of the 100 points). Coverage is capped at 87% (47 of 54). Decide whether to keep the table as is.
* **O-3. Severity map** (low 1, medium 2, high 3) is mine, because the registry has no 4-level risk. Confirm or supply the mapping.
* **O-4. Weight table and category mapping** (section 3) are the old figures carried over. Confirm.
* **O-5. Fingerprint uniqueness.** The task says to treat it as "the approved registry item". **No such hexagon exists** in the registry (12 fingerprint items, none is uniqueness). The old "+20 fingerprint bonus" is not part of `exposure-v1`. The `2^(confirmed/4)` estimate was already removed from the popup by CK-7799. Adding a uniqueness hexagon would be a registry change (MPC-7466) and a change to what is scanned, which is out of scope here.
* **O-6. A very low-coverage score.** A scan with 2 items checked can say "100, High" next to "4% coverage". The contract follows D-d literally. Whether to withhold or caveat a score below some coverage is a product decision; none is invented here.
* **O-7. Z for conditional hexagons** belongs to MPC-7471-F2. This contract takes Z as a parameter (default: the registry's 54). If F2 decides Z excludes hexagons that do not apply to a device, pass it as `{ total }`; nothing else changes.
* **O-8. Two score families.** The score above is the **browser web-scan** score. A different score exists for **email-footprint scans** (see section 6). They measure different things and must not share a name. Decide whether the email one is renamed, kept, or later unified. Not touched here.
* **O-9. Server-side recomputation of the baseline.** The baseline Worker receives the score from the browser and can only range-check it. Recomputing needs the per-hexagon statuses sent to `mpt-leads`, a new data flow that needs a privacy decision. Not done. (If MPC-7471-F3 option A moves the popup onto the report pipeline, the saved scan already holds the statuses and the Worker can recompute from it.)
* **O-10. Wording.** Band labels ("Low/Medium/High exposure"), "Exposure score", "Coverage" and "Not enough checked to score" are drafts in code. The explainer (`docs/exposure-score-explainer-draft.md`) is a draft and is **not routed or linked** until Chris approves it.

## 5. Mathematical requirements and where they are tested

`shared/hexagon-registry/score.test.mjs` (node, 22 tests): range 0-100 over 500 seeded random scans; weights sum to exactly 100; determinism and input-order invariance over 200 scans; with the checked set fixed, clear to found never lowers the score (300 scans, every flip); not-checked items change neither score, band, coverage nor categories (200 scans); boundaries 39/40 and 69/70 for every integer 0-100; half-up rounding checked against an independent exact oracle on seeded scans whose exact score ends in .5; zero checked; categories with no checked item; mixed severities; invalid, unknown, duplicate and conflicting input; coverage against Z; the known limitation (O-1).

**Where the task's statements conflict, and how they are read.** "Not-checked items do not affect the score" is true for a fixed scan: adding or removing not-checked items changes nothing. It is **not** a claim that new evidence cannot change a provisional score. When an item becomes checked, the score may move, and when the first checked item appears in a category, the active weights change, so the score can **fall even though nothing became more exposed** (test: "documented edge conflict"). That is why monotonicity is stated with the checked set held fixed, and why a mid-scan number is provisional.

## 6. Consumers: inventory, before and after

| Consumer | Before (verified on main `baf7f50`) | Now |
|---|---|---|
| Page ring `RiskScore.tsx` | its own weighted formula with social, security, behaviour and fingerprint sub-rules; bands **80 / 50**, "Low" from 1; showed `NN%` | shared score; bands 40/70; labelled provisional until all points are confirmed; no `%` |
| Completion popup and PDF `FinalSummaryPanel.tsx` | "FINAL FORMULA": min(confirmed/total x 60 + critical x 20 + warnings x 10, 100), weighted, **plus** a fingerprint bonus of up to +20; bands 70/40 repeated on 11 lines; "Exposure" = round(confirmed / 54 x 100) | shared score, band, coverage; "Exposure" renamed Coverage; PDF shows `exposure-v1`; no copied constants |
| Email popup `EmailCaptureModal.tsx` | band copy 70/40; `exposurePct` | band from shared, coverage from the same result; sends `scoreVersion` |
| Dead code `RiskProfileSelector.tsx` | band copy 70/40 (no importer) | band from shared |
| Saved baseline (`mpt-leads` Worker, `mpt_score_baselines`) | stores whatever 0-100 the browser sends; no version | version-aware (see section 7); legacy rows untouched |
| JSON export (page) | `overallPrivacyRisk`, `riskLevel`, `trackingExposure` | `scoreVersion`, `exposureScore`, `band`, `provisional`, `coveragePercent`, `itemsChecked`, `itemsTotal` (the three old keys are gone: **breaking for anyone parsing the export**) |
| Report email and JSON attachment (`scan-report`, `reportHex.js`) | no web-scan score at all; the existing `score` field is the email-footprint score | `web_scan.exposure` added from the saved statuses; **no score line in the email body** (wording not approved) |
| Worker `scan-report/lib/score.js` | "Privacy Health Score" = 100 minus weighted signals, **higher is safer**, bands 90/70/50, email-footprint categories | **not changed** (family B, O-8) |

**Not migrated, and why (the acceptance criterion "used everywhere" is therefore not met for these):**

* `VoiceAI.tsx` `calculateRiskScore`: Alice says "Your risk score is N out of 100", computed as **100 minus 10 per tapped hexagon**, with its own 70/40 bands, stored in local storage as `bestRiskScore` and shown by `VoiceStatsBadge` and `VoiceDebugPanel`. It is behind the honest-tiles flag (MPC-7916, score off when on). Migrating it changes Alice's spoken script, which is approved copy.
* `ScanRevealFlow.tsx` and `ScanResults.tsx` (`exposure_score` with Critical/High/Medium/Low at 80/60/40) and `src/lib/riskScoring.ts` (`min(100, breaches x 10 + pastes x 5)`, bands 0/1-29/30-59/60+): the **email-footprint family**.

## 7. Versions, baselines and legacy

* New results are tagged `exposure-v1`. Anything saved before is `legacy`. Scores of different versions are never subtracted and never presented as improvement.
* Proposed migration `supabase/proposed/20261026000000_mpc_7471_f4_baseline_score_version.sql` adds `score_version text not null default 'legacy'` (every existing row becomes legacy by default, none is rewritten) and replaces `unique(email_hash)` with `unique(email_hash, score_version)`, so a user keeps the legacy baseline **and** gets a first `exposure-v1` baseline. It is **not applied** and sits outside `supabase/migrations/` because `deploy-supabase.yml` runs `db push` on merge. It was tested only on a throwaway local Postgres 16 (apply, apply twice, versioned inserts, legacy preserved, rollback restores identical legacy rows and the unique key). It has not been run on staging (none exists) or production.
* Release order: apply the migration (Chris), verify, merge/deploy the Worker, then set `BASELINE_SCORE_VERSION_COLUMN="true"`. Until the flag is on, the Worker stores unversioned (legacy) submissions exactly as before and **does not store** an `exposure-v1` score (it could not be tagged and would later be read as legacy). Consequence: between merge and the flag, new-method baselines are not saved.
* The popup shows a legacy baseline as "used an older method, so it cannot be compared with today's" and no delta.

## 8. Integration notes for MPC-7471-F1, F3 and report consumers

* **Do not compute a score in a component.** Call `exposureForPage(hexagons, final)` (`src/lib/exposureScore.ts`) once and pass the `ExposureResult` (or `score`, `score_version`, `coverage.percent`) down. `EmailCaptureModal` currently takes `riskScore`, `scoreVersion`, `coveragePercent`, `categoryScores`; F1 may replace those with one `exposure` prop, keeping the same fields.
* **F1 (one popup).** Criterion 3 ("score matches the page") is met by construction: the ring and the popup read the same function. Mid-scan the ring is labelled provisional. Keep the `scoreVersion` in what the popup posts.
* **F3 (one route).** If the popup posts to the report pipeline, send the same `scoreVersion`, and carry the baseline write (the `mpt_score_baselines` insert and the version rules in `saveBaseline`) with it, or retire it deliberately. The saved scan stores statuses, so `computeExposure` can be run server-side from the saved scan (resolves O-9).
* **F2 (total Z).** Pass F2's Z as `{ total }`; coverage and the report JSON follow.
* **Deployment side effect:** `deploy-scan-report.yml` triggers on `shared/hexagon-registry/**`, so merging this deploys the scan-report Worker. `mpt-leads` also deploys. Treat the merge as a production action.
* Report consumers: `web_scan.exposure` in the JSON attachment is additive. The existing top-level `score` there is the email-footprint score (higher is safer); they have opposite polarity, which is why the field is named `exposure`.

## 9. Risks and rollback

Revert the PR to restore the old formulas. The Worker flag defaults off. The migration's own rollback is in its header and was tested. Because the JSON export keys changed, revert also restores them.

## 10. Evidence

Synthetic before/after screenshots (same 12-hexagon synthetic scan through `main` and this branch, rendered in a throwaway harness, nothing sent anywhere): `docs/screenshots/mpc-7471-f4/`. Before: "53/100 risk score, 22% exposure" (22% = tapped hexagons / 54). After: "55/100 exposure score, 17% coverage" (hand calculation in `src/lib/exposureScore.replay.test.tsx`).

Not changed and easy to misread: the per-category rows under "Category Breakdown" still show the tapped "confirmed / total" count and its percentage. That is the visitor's confirmation progress, **not** category exposure. Renaming or removing it is a copy decision for F1.
