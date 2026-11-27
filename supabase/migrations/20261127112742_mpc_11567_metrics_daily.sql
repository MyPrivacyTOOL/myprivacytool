-- MPC-11567: one row per scorecard measure per day, written by the daily job (scripts/metrics-daily.mjs, workflow metrics-daily.yml).
-- Additive only: one new empty table. Nothing existing is read differently or changed. No product code reads it.
--   as_of    the UTC day the job ran. First row is the day the job first ran: no backfill, ever.
--   measure  M1, M2, M3 or G (the four hexagon-scorecard measures from MPC-11547). The locked KPI is not stored here.
--   value    the measured number for the current period, or NULL. NULL = not computable or the run failed. Never a stand-in zero.
--   status   what the value means: ok, lower_bound, no_stored_scans, dormant (a value is present) or no_scans, not_computable, failed (value is NULL).
--   note     always filled: the period, and the reason when the status is not ok. A failed run writes the reason here.
-- Access: RLS on with no anon or authenticated policy, so only the service role reads or writes it (same as public.scans). Idempotent.
create table if not exists public.metrics_daily (
  as_of   date    not null,
  measure text    not null,
  value   numeric,
  status  text    not null,
  note    text    not null,
  constraint metrics_daily_pkey primary key (as_of, measure),
  constraint metrics_daily_measure_known check (measure in ('M1', 'M2', 'M3', 'G')),
  constraint metrics_daily_status_known check (status in ('ok', 'lower_bound', 'no_stored_scans', 'dormant', 'no_scans', 'not_computable', 'failed')),
  constraint metrics_daily_no_value_without_a_measurement check (value is null or status in ('ok', 'lower_bound', 'no_stored_scans', 'dormant')),
  constraint metrics_daily_note_filled check (length(btrim(note)) > 0)
);

alter table public.metrics_daily enable row level security;
alter table public.metrics_daily force row level security;
revoke all on table public.metrics_daily from anon, authenticated;

comment on table public.metrics_daily is 'MPC-11567. One row per hexagon-scorecard measure (M1, M2, M3, G) per UTC day, written by the daily job. value is NULL, never 0, when a measure is not computable or the run failed; note always says why. Not backfilled, not estimated, not carried forward.';

-- Rollback (nothing else depends on it): drop table public.metrics_daily;
