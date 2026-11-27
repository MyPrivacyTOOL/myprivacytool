# Hexagon scorecard: M1, M2, M3 and G (MPC-11547)

Measurement only. The locked KPI (10,000 free scans / 1,000 paid / $120k ARR by 2027-08-01) stays the headline; these four sit beside it.
Nothing here changes a table, `exposure-v1`, `scanCounts` or any product score. No Notion row is written.

| | Where | Definition |
|---|---|---|
| M1 | `mpt_scorecard_m1_weekly` | Completed web scans with at least one **found** result, per Hong Kong (ISO) week. Test mailbox left out. |
| M2 | `mpt_scorecard_m2_weekly` | Median, per completed web scan, of distinct registry hexagons that are **found or checked-and-clear**, per week. Scans with none count as 0. Test mailbox left out. |
| M3 | `mpt_scorecard_m3_monthly` | Tiles whose `confidence_config` value was changed (against the previous version, else the registry) and then **validated**: 30+ follow-up responders under that version whose 95% Wilson interval contains the new value. Counted in the month the 30th responder arrived. |
| G | `mpt_scorecard_g_weekly` | Disputes on high-confidence tiles / high-confidence tiles shown, per week. High = confidence in force **above 0.8**. NULL, never 0%, when no high-confidence prompt has been answered. |

Context view: `mpt_scorecard_deleted_scans_weekly`. Base view: `mpt_scorecard_web_scan_facts`. Report: `node scripts/metrics-report.mjs` (GET only; `--now`, `--rows <file>`).
Sample: `docs/scorecard-mpc-11547.sample.json`, made with `--rows` from the six live production views read on 2026-11-27 (the migration was applied to production that day by hand through the Supabase tool, not by `deploy-supabase.yml`, which is manual-only; production's migration history does not match the repo's file versions, so do not use `supabase db push`). The script itself was not run against the REST API: that needs the service-role key.

## How "found", "clear" and "high confidence" are decided
- Found / clear follow `scanCounts`: first occurrence of an id, unknown ids ignored, `cannot_be_checked` hexagons never count, and `clear` only counts where the registry allows it. SQL carries a copy of those registry facts (`mpt_scorecard_registry()`); `scripts/metrics-report.test.mjs` fails if it drifts from `registry.js`.
- M3's rules (30 responders, z = 1.96, first answer per person, a confident finding judged as `1 - dispute rate`) copy `src/lib/learning/aggregate.ts`; G's 0.8 copies `HIGH_CONFIDENCE` in `src/lib/findingConfirmation.ts`. Both are pinned by the same test.

## What cannot be computed today (reported, not worked around)
1. **G is not computable.** The tile counters hold `shown` events only (614 since 2026-11-09) and zero answers, so there is nothing to divide. The counters also carry no confidence and no config version, so "high confidence" is the confidence in force *now*.
2. **M3 is 0**, as expected: only `confidence_config` version 0 exists. It also could not be validated yet: since MPC-9892 the browser sends no person key and `mpt_hexagon_events` is empty.
3. **M1 and M2 are lower bounds.** They read the web scans still stored. Deleted scans (54 so far) survive only as undated counters, so they cannot be placed in the week they were made. Of the stored scans in the last two weeks, all are the test mailbox, so the current M1 is 0 with status `no_stored_scans` and M2 has no median.
4. Test-mailbox scans are recognised only while the linked `public.scans` row exists (it is purged on retention); an old test scan whose row is gone would count as real.
5. A saved item without a valid `status` counts as not checked (the browser-side recomputation `scanCounts` can do from the value is not available in SQL).

## Tests
`supabase/tests/mpc-11547-scorecard.test.sql` (fixtures with hand-worked answers, run by `supabase/tests/run.sh`) and `scripts/metrics-report.test.mjs` (in `npm run test:workers:node`). The SQL test was mutation-checked: dropping the test-mailbox filter, the clear-allowed rule, the cannot-be-checked rule, the "after the bump" rule or the strict `> 0.8` each fails it.
