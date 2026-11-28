# Hexagon scorecard: M1, M2, M3 and G (MPC-11547)

Measurement only. The locked KPI (10,000 free scans / 1,000 paid / $120k ARR by 2027-08-01) stays the headline; these four sit beside it.
Nothing here changes `exposure-v1`, `scanCounts` or any product score. The views and `scripts/metrics-report.mjs` write nothing; the daily job (below, MPC-11567) is the only writer.

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

## Daily schedule and the one place to read it (MPC-11567)
- **Schedule:** `.github/workflows/metrics-daily.yml`, one GitHub Actions cron, **daily 06:00 UTC**, runs `node scripts/metrics-daily.mjs`, which runs `metrics-report.mjs` (read only).
- **Storage:** `public.metrics_daily (as_of, measure, value, status, note)`, primary key `(as_of, measure)`, measures `M1`, `M2`, `M3`, `G`. `value` is NULL (never 0) when a measure is not computable or the run failed; `note` is always filled. RLS on, no policy: service role only. The value is the **current** period (Hong Kong week or month, still in progress); the last complete week is named in the note, labelled with its own date. First row is the first day the job ran: no backfill, no estimate, no value carried forward.
- **Display:** one Notion page, `MPT > Scorecard — M1/M2/M3/G` (https://app.notion.com/p/42528547eaa7817d9478cf9f8c77f64e), rewritten by the job from `metrics_daily`: the locked KPI as the headline (a target, not computed), a red or green run banner, today's four rows with as_of and status, and the last seven days. Not a dashboard; the Master Index is not the display.
- **Failure is visible:** if the report cannot be produced, the job stores four `failed` rows (value NULL, the reason in `note`), the page shows the red banner and the failed rows, and the run exits 1 (red). If the store or the Notion write fails, the page (where it can be written) says so and the run is red. A second run the same day replaces the first row but keeps what it said in `note` (`Recovered after a failed run at <time>: <reason>. ...`).
- **Failure drill:** run the workflow by hand with `drill = true` (or `node scripts/metrics-daily.mjs --drill`): the report read asks for a view that does not exist, so the real failure path runs (HTTP 404), and the run ends red on purpose. Run it without `drill` afterwards to put the day's real rows back.
- **Secrets:** reuses `NEW_SUPABASE_SECRET_KEY` (else `SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY`) and `NOTION_TOKEN`; none is new. The Notion integration behind `NOTION_TOKEN` must be able to edit the Scorecard page.
- **A day the job never starts:** leaves no row and no page change (the page keeps an old `as_of`). `.github/workflows/metrics-daily-alive.yml` (daily 09:00 UTC, `scripts/metrics-daily-alive/`) reads `metrics_daily` and turns red when today's four rows are missing or incomplete (a `failed` row counts as present: the daily job is already red for it). Read-only; independent of the job and of Notion. It does not write to the Notion page, and it cannot catch GitHub dropping its own schedule twice in a row.
- **Migration:** `supabase/migrations/20261127112742_mpc_11567_metrics_daily.sql` (applied to production 2026-11-27 11:27 UTC through the Supabase tool, so the file carries the live version 20261127112742; `deploy-supabase.yml` is manual-only and was not used). Tests: `supabase/tests/mpc-11567-metrics-daily.test.sql` (mutation-checked: dropping the no-value rule or granting `anon` each fails it) and `scripts/metrics-daily.test.mjs`.
