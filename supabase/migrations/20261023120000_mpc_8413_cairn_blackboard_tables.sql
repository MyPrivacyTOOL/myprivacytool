-- MPC-8413 (spec MPC-8401, design approved MPC-8410): Cairn OSINT blackboard tables.
-- Already applied to the live project as migration "mpc_8413_cairn_blackboard_tables".
-- Deviations from the spec, deliberate:
--  * user_id references public.users (auth.users is empty), nullable, ON DELETE CASCADE so deletion-on-request removes everything.
--  * id patterns loosened: the spec's own example ids did not match its regexes.
--  * timestamptz instead of timestamp; FORCE RLS; anon/authenticated grants revoked; authenticated gets SELECT on own rows only.
--  * 72h retention (Cairn strategy page) enforced by retain_until + an hourly purge (scheduled in 20261023120100).
--
-- Rollback:
--   drop table public.cairn_intents, public.cairn_facts, public.cairn_sessions cascade;
--   drop function public.mpt_purge_expired_cairn_sessions();
--   (and the cron job, see 20261023120100_mpc_8413_cairn_purge_pg_cron.sql)

create table public.cairn_sessions (
  id bigserial primary key,
  session_id text unique not null,
  user_id uuid references public.users(id) on delete cascade,
  seed_email text not null,
  seed_username text,
  investigation_goal text,
  allowed_domains jsonb not null default '[]'::jsonb,
  excluded_domains jsonb not null default '[]'::jsonb,
  max_depth integer not null default 3,
  max_facts integer not null default 100,
  status text not null default 'active',
  status_reason text,
  facts_discovered integer not null default 0,
  intents_generated integer not null default 0,
  intents_completed integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  concluded_at timestamptz,
  timeout_seconds integer not null default 300,
  retain_until timestamptz not null default (now() + interval '72 hours'),
  cairn_project_id text,
  metadata jsonb not null default '{}'::jsonb,
  constraint cairn_sessions_session_id_format check (session_id ~ '^mpt-cairn-[0-9]{10,}$'),
  constraint cairn_sessions_status_valid check (status in ('active','paused','completed','failed'))
);
create index idx_cairn_sessions_user_id on public.cairn_sessions(user_id);
create index idx_cairn_sessions_status on public.cairn_sessions(status);
create index idx_cairn_sessions_created_at on public.cairn_sessions(created_at desc);
create index idx_cairn_sessions_retain_until on public.cairn_sessions(retain_until);

create table public.cairn_facts (
  id bigserial primary key,
  fact_id text unique not null,
  session_id bigint not null references public.cairn_sessions(id) on delete cascade,
  description text not null,
  fact_type text,
  fact_value text,
  confidence_score numeric(3,2) not null default 0.50,
  source_name text,
  source_url text,
  extracted_metadata jsonb not null default '{}'::jsonb,
  discovered_from_intent_id text,
  discovery_chain jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  is_hashed boolean not null default false,
  hash_algorithm text,
  data_classification text not null default 'sensitive',
  constraint cairn_facts_fact_id_format check (fact_id ~ '^cairn-fact-[A-Za-z0-9_-]{3,64}$'),
  constraint cairn_facts_confidence_range check (confidence_score >= 0.0 and confidence_score <= 1.0),
  constraint cairn_facts_hash_consistent check (not is_hashed or hash_algorithm is not null),
  constraint cairn_facts_hash_algorithm_valid check (hash_algorithm is null or hash_algorithm in ('bcrypt','sha256','sha512','hmac-sha256')),
  constraint cairn_facts_classification_valid check (data_classification in ('sensitive','public','internal'))
);
create index idx_cairn_facts_session_id on public.cairn_facts(session_id);
create index idx_cairn_facts_fact_type on public.cairn_facts(fact_type);
create index idx_cairn_facts_confidence on public.cairn_facts(confidence_score desc);
create index idx_cairn_facts_created_at on public.cairn_facts(created_at desc);
create index idx_cairn_facts_description_fts on public.cairn_facts using gin (to_tsvector('english', description));

create table public.cairn_intents (
  id bigserial primary key,
  intent_id text unique not null,
  session_id bigint not null references public.cairn_sessions(id) on delete cascade,
  description text not null,
  intent_type text,
  from_fact_ids text[] not null default '{}',
  target_fact_id text,
  creator text,
  status text not null default 'pending',
  worker_assigned text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  timeout_seconds integer not null default 60,
  result_summary text,
  error_message text,
  execution_metadata jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  human_hint text,
  is_paused boolean not null default false,
  pause_reason text,
  constraint cairn_intents_intent_id_format check (intent_id ~ '^cairn-intent-[A-Za-z0-9_-]{3,64}$'),
  constraint cairn_intents_status_valid check (status in ('pending','active','completed','failed','blocked'))
);
create index idx_cairn_intents_session_id on public.cairn_intents(session_id);
create index idx_cairn_intents_status on public.cairn_intents(status);
create index idx_cairn_intents_creator on public.cairn_intents(creator);
create index idx_cairn_intents_created_at on public.cairn_intents(created_at desc);
create index idx_cairn_intents_from_facts on public.cairn_intents using gin (from_fact_ids);

alter table public.cairn_sessions enable row level security;
alter table public.cairn_facts enable row level security;
alter table public.cairn_intents enable row level security;
alter table public.cairn_sessions force row level security;
alter table public.cairn_facts force row level security;
alter table public.cairn_intents force row level security;

revoke all on public.cairn_sessions, public.cairn_facts, public.cairn_intents from anon, authenticated;
revoke all on sequence public.cairn_sessions_id_seq, public.cairn_facts_id_seq, public.cairn_intents_id_seq from anon, authenticated;
grant select on public.cairn_sessions, public.cairn_facts, public.cairn_intents to authenticated;
grant all on public.cairn_sessions, public.cairn_facts, public.cairn_intents to service_role;
grant usage, select on sequence public.cairn_sessions_id_seq, public.cairn_facts_id_seq, public.cairn_intents_id_seq to service_role;

create policy cairn_sessions_owner_read on public.cairn_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy cairn_facts_owner_read on public.cairn_facts
  for select to authenticated using (session_id in (select s.id from public.cairn_sessions s where s.user_id = (select auth.uid())));
create policy cairn_intents_owner_read on public.cairn_intents
  for select to authenticated using (session_id in (select s.id from public.cairn_sessions s where s.user_id = (select auth.uid())));
create policy cairn_sessions_service on public.cairn_sessions for all to service_role using (true) with check (true);
create policy cairn_facts_service on public.cairn_facts for all to service_role using (true) with check (true);
create policy cairn_intents_service on public.cairn_intents for all to service_role using (true) with check (true);

create or replace function public.mpt_purge_expired_cairn_sessions()
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  delete from public.cairn_sessions where retain_until < now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mpt_purge_expired_cairn_sessions() from public, anon, authenticated;
grant execute on function public.mpt_purge_expired_cairn_sessions() to service_role;

comment on table public.cairn_sessions is 'MPC-8413 / spec MPC-8401. One row per Cairn OSINT deep-scan run. Holds the seed email, so it is personal data. 72h retention (retain_until; purge job mpt-purge-expired-cairn-sessions); facts and intents cascade. Deletion on request removes the row. Writes via service_role only; authenticated may read own rows.';
comment on table public.cairn_facts is 'MPC-8413 / spec MPC-8401. Facts Cairn discovered about the seed. Sensitive types (phone, etc.) must arrive hashed (is_hashed + hash_algorithm); never dehash. Cascades with the session. Writes via service_role only.';
comment on table public.cairn_intents is 'MPC-8413 / spec MPC-8401. Cairn investigation-direction queue and audit trail. Cascades with the session. Writes via service_role only.';
