-- MPC-7471-F4 (PROPOSED, NOT APPLIED). Deliberately NOT in supabase/migrations/: deploy-supabase.yml runs `db push` on merge when its secrets are set.
-- Moving this file into supabase/migrations/ (or running it in the SQL editor) is the production release step and needs Chris's migration approval.
--
-- Purpose: tag every stored baseline with the score version that produced it, keep every existing row as 'legacy', and let a user hold one baseline PER version
-- (so a first exposure-v1 scan gets its own baseline) without ever overwriting or recomputing the legacy one. Legacy and versioned scores are never compared.
--
-- Safe for the code before and after: the column defaults to 'legacy', so a Worker that does not send score_version keeps writing correct legacy rows.
-- The Worker (workers/mpt-leads/worker.js) only starts writing versioned rows when BASELINE_SCORE_VERSION_COLUMN = "true" is set AFTER this is applied.
-- Release order: 1) apply this  2) verify (queries at the foot)  3) merge/deploy the Worker  4) set BASELINE_SCORE_VERSION_COLUMN="true".
--
-- ROLLBACK (data-preserving; run only if no versioned rows are wanted any more):
--   delete from public.mpt_score_baselines where score_version <> 'legacy';   -- only removes the NEW versioned rows; legacy rows are untouched
--   drop index if exists public.mpt_score_baselines_email_version_key;
--   alter table public.mpt_score_baselines add constraint mpt_score_baselines_email_hash_key unique (email_hash);
--   alter table public.mpt_score_baselines drop column score_version;

begin;

alter table public.mpt_score_baselines
  add column if not exists score_version text not null default 'legacy'
  check (score_version = 'legacy' or score_version ~ '^[a-z]+-v[0-9]{1,3}$');

comment on column public.mpt_score_baselines.score_version is
  'MPC-7471-F4. The scoring contract that produced overall_score/category_scores. ''legacy'' = saved before the shared contract (two different old formulas); never compare across versions.';

-- One baseline per email hash AND version (first scan of that version wins), instead of one per hash.
alter table public.mpt_score_baselines drop constraint if exists mpt_score_baselines_email_hash_key;
create unique index if not exists mpt_score_baselines_email_version_key on public.mpt_score_baselines (email_hash, score_version);

commit;

-- VERIFY (read-only): every pre-existing row is legacy, nothing was rewritten.
--   select score_version, count(*) from public.mpt_score_baselines group by 1;                       -- expect only 'legacy' right after applying
--   select count(*) from public.mpt_score_baselines where overall_score is null;                      -- expect 0
