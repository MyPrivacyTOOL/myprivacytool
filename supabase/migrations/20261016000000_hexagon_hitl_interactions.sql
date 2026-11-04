-- HITL identity confirmation loop: persist what the visitor says about each deep-dive finding, and feed disputes to the OSINT engine.
--
-- public.mpt_hexagon_interactions   one row per accepted confirm / reject / dispute. scan_session_id is the deep-dive scan_id
--                                   (the webhook-receiver Worker only accepts it when the scan exists, is unexpired and belongs to a
--                                   wa_id that messaged us: that is the proof-of-possession check). No wa_id or finding value is stored here.
-- public.osint_engine_tuning_log    learning loop: one row per rejected / disputed finding that names its OSINT provider. No session id,
--                                   on purpose: the engine tunes per provider, not per person.
--
-- Access: RLS forced, no anon/authenticated grants, service_role only (the webhook-receiver Worker). Idempotent.
-- Rollback: drop table if exists public.osint_engine_tuning_log; drop table if exists public.mpt_hexagon_interactions;

create table if not exists public.mpt_hexagon_interactions (
  id                        uuid primary key default gen_random_uuid(),
  scan_session_id           varchar(64) not null,
  hexagon_id                varchar(64) not null,
  user_action               varchar(16) not null check (user_action in ('confirmed', 'rejected', 'disputed')),
  original_confidence_score double precision check (original_confidence_score is null or original_confidence_score between 0 and 1),
  osint_source              varchar(64),
  created_at                timestamptz not null default now()
);
comment on table public.mpt_hexagon_interactions is 'HITL answers on deep-dive findings. Append-only. confirmed counts toward the verified risk score; rejected (false_positive) and disputed never do.';
create index if not exists mpt_hexagon_interactions_session_idx on public.mpt_hexagon_interactions (scan_session_id, hexagon_id, created_at desc);

create table if not exists public.osint_engine_tuning_log (
  id           uuid primary key default gen_random_uuid(),
  hexagon_id   varchar(64) not null,
  osint_source varchar(64) not null,
  action_type  varchar(24) not null check (action_type in ('false_positive_rate', 'dispute_rate')),
  created_at   timestamptz not null default now()
);
comment on table public.osint_engine_tuning_log is 'Learning loop. rejected -> false_positive_rate, disputed -> dispute_rate. Read by the OSINT engine to lower confidence per provider.';
create index if not exists osint_engine_tuning_log_source_idx on public.osint_engine_tuning_log (osint_source, action_type, created_at desc);

alter table public.mpt_hexagon_interactions enable row level security; alter table public.mpt_hexagon_interactions force row level security;
alter table public.osint_engine_tuning_log enable row level security;  alter table public.osint_engine_tuning_log force row level security;
revoke all on public.mpt_hexagon_interactions, public.osint_engine_tuning_log from public, anon, authenticated;
grant all on public.mpt_hexagon_interactions, public.osint_engine_tuning_log to service_role;
drop policy if exists "service role full access" on public.mpt_hexagon_interactions;
create policy "service role full access" on public.mpt_hexagon_interactions for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.osint_engine_tuning_log;
create policy "service role full access" on public.osint_engine_tuning_log for all to service_role using (true) with check (true);
