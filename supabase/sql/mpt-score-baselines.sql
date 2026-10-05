-- MPC-7173: Identity Baseline v1 - one dated privacy score snapshot per user, saved after a scan.
-- The key is a SHA-256 hash of the lower-cased email (computed in the mpt-leads Worker), so this
-- table holds no raw email and no raw scan data - only the overall score and per-category scores
-- the live product already computes in the browser. The first completed scan creates the baseline;
-- later scans are compared against it (never overwrite it). Writes via service_role only.

create table public.mpt_score_baselines (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique check (email_hash ~ '^[0-9a-f]{64}$'),
  overall_score integer not null check (overall_score between 0 and 100),
  category_scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.mpt_score_baselines is
  'Dated baseline privacy risk score (0-100, higher = more exposed) per hashed email. One row per user, first scan wins. service_role only; no user-facing access.';

alter table public.mpt_score_baselines enable row level security;
alter table public.mpt_score_baselines force row level security;
revoke all on public.mpt_score_baselines from anon, authenticated;
-- No policies: deny-by-default for anon/authenticated; service_role bypasses RLS.
