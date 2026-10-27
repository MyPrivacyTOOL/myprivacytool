-- MPC-8673: the Flip Point, database part. Spec: "MPT - The Flip Point (Specification)" in Notion (10 - Strategy & Planning).
--
-- Rule enforced here: NO done-for-you eradication job can be queued or started without a valid consent: it exists, is not withdrawn, is inside its
-- 24-hour start window, and covers the category. The check lives in these functions, not only in a Worker, so no caller can skip it.
--
-- Lives in supabase/proposed/ on purpose: deploy-supabase.yml ignores this folder, so merging the PR applies NOTHING to production.
-- Moving it to supabase/migrations/ is the production step and needs the owner's explicit go-ahead.
--
-- Privacy: no item content, names or personal URLs in either table. scan_ref is an opaque uuid with NO foreign key, so purging scans (7 days) does not
-- delete the consent record, which is kept 12 months after eradication completes (approved by counsel per the owner, 2026-10-28).
-- PROPOSED, not counsel-approved: consents that were never used (expired or withdrawn, no job queued or running) are purged 30 days after expiry/withdrawal.
--
-- Rollback: select cron.unschedule('mpt-purge-deletion-consents');  drop function if exists public.mpt_purge_deletion_consents(boolean),
--   public.eradication_finish(uuid, boolean), public.eradication_begin(uuid), public.eradication_start(uuid, text),
--   public.withdraw_deletion_consent(uuid), public.create_deletion_consent(uuid, text[], boolean, boolean, integer);
--   drop table if exists public.eradication_jobs; drop table if exists public.deletion_consents;

create table if not exists public.deletion_consents (
  id                         uuid primary key default gen_random_uuid(),
  scan_ref                   uuid not null,
  categories                 text[] not null,
  irreversible               boolean not null default false,
  irreversible_ack           boolean not null default false,       -- the user typed DELETE
  price_cents                integer not null default 0 check (price_cents >= 0),   -- price shown before consent
  created_at                 timestamptz not null default now(),
  expires_at                 timestamptz not null default (now() + interval '24 hours'),   -- window to queue jobs
  withdrawn_at               timestamptz,
  eradication_completed_at   timestamptz,                          -- starts the 12-month retention clock
  check (cardinality(categories) between 1 and 8),
  check (categories <@ array['broker','search','social','email','device','network','professional','ai_threat']::text[]),
  check (not irreversible or irreversible_ack),
  check (expires_at > created_at)
);
create index if not exists deletion_consents_completed_idx on public.deletion_consents (eradication_completed_at);
create index if not exists deletion_consents_expires_idx on public.deletion_consents (expires_at);
comment on table public.deletion_consents is 'MPC-8673. One row per Flip Point consent. No item content. scan_ref has no foreign key on purpose. service_role only.';

create table if not exists public.eradication_jobs (
  id           uuid primary key default gen_random_uuid(),
  consent_id   uuid not null references public.deletion_consents (id) on delete cascade,
  category     text not null,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create unique index if not exists eradication_jobs_active_key on public.eradication_jobs (consent_id, category) where status in ('queued', 'running', 'done');
create index if not exists eradication_jobs_consent_idx on public.eradication_jobs (consent_id);
comment on table public.eradication_jobs is 'MPC-8673. One job per consented category. Counts and states only. service_role only.';

alter table public.deletion_consents enable row level security;
alter table public.deletion_consents force row level security;
alter table public.eradication_jobs enable row level security;
alter table public.eradication_jobs force row level security;
revoke all on public.deletion_consents, public.eradication_jobs from public, anon, authenticated;
grant select on public.deletion_consents, public.eradication_jobs to service_role;

-- ---------------------------------------------------------------- create
create or replace function public.create_deletion_consent(
  p_scan_ref uuid, p_categories text[], p_irreversible boolean default false, p_irreversible_ack boolean default false, p_price_cents integer default 0)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare cats text[]; cid uuid;
begin
  if p_scan_ref is null then raise exception 'scan_ref_required'; end if;
  select coalesce(array_agg(distinct c order by c), '{}'::text[]) into cats from unnest(p_categories) c;
  insert into public.deletion_consents (scan_ref, categories, irreversible, irreversible_ack, price_cents)
  values (p_scan_ref, cats, coalesce(p_irreversible, false), coalesce(p_irreversible_ack, false), coalesce(p_price_cents, 0))
  returning id into cid;
  return cid;
end $$;

-- ---------------------------------------------------------------- queue a job (the gate)
create or replace function public.eradication_start(p_consent_id uuid, p_category text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.deletion_consents; jid uuid;
begin
  select * into c from public.deletion_consents where id = p_consent_id for share;
  if not found then raise exception 'consent_not_found'; end if;
  if c.withdrawn_at is not null then raise exception 'consent_withdrawn'; end if;
  if c.expires_at <= now() then raise exception 'consent_expired'; end if;
  if p_category is null or not (p_category = any (c.categories)) then raise exception 'category_not_consented'; end if;
  begin
    insert into public.eradication_jobs (consent_id, category) values (p_consent_id, p_category) returning id into jid;
  exception when unique_violation then
    raise exception 'job_already_started';
  end;
  return jid;
end $$;

-- ---------------------------------------------------------------- begin running (re-checks withdrawal)
-- Returns false, and cancels the job, if the consent was withdrawn after the job was queued.
create or replace function public.eradication_begin(p_job_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.eradication_jobs; c public.deletion_consents;
begin
  select * into j from public.eradication_jobs where id = p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status <> 'queued' then raise exception 'job_not_queued'; end if;
  select * into c from public.deletion_consents where id = j.consent_id for share;
  if c.withdrawn_at is not null then
    update public.eradication_jobs set status = 'cancelled', finished_at = now() where id = j.id;
    return false;
  end if;
  update public.eradication_jobs set status = 'running', started_at = now() where id = j.id;
  return true;
end $$;

-- ---------------------------------------------------------------- finish
create or replace function public.eradication_finish(p_job_id uuid, p_ok boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.eradication_jobs; c public.deletion_consents;
begin
  select * into j from public.eradication_jobs where id = p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status <> 'running' then raise exception 'job_not_running'; end if;
  update public.eradication_jobs set status = case when coalesce(p_ok, false) then 'done' else 'failed' end, finished_at = now() where id = j.id;
  if coalesce(p_ok, false) then
    select * into c from public.deletion_consents where id = j.consent_id for update;
    if c.eradication_completed_at is null and not exists (
         select 1 from unnest(c.categories) cat
          where not exists (select 1 from public.eradication_jobs x where x.consent_id = c.id and x.category = cat and x.status = 'done')) then
      update public.deletion_consents set eradication_completed_at = now() where id = c.id;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- withdraw
-- Cancels QUEUED jobs. A job already running cannot be recalled, but no new job can start for a withdrawn consent.
create or replace function public.withdraw_deletion_consent(p_consent_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.deletion_consents set withdrawn_at = coalesce(withdrawn_at, now()) where id = p_consent_id;
  if not found then raise exception 'consent_not_found'; end if;
  update public.eradication_jobs set status = 'cancelled', finished_at = now() where consent_id = p_consent_id and status = 'queued';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- purge (dry run by default)
create or replace function public.mpt_purge_deletion_consents(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_completed int; n_abandoned int; n_deleted int := 0;
begin
  select count(*) into n_completed from public.deletion_consents where eradication_completed_at < now() - interval '12 months';
  select count(*) into n_abandoned from public.deletion_consents d
   where d.eradication_completed_at is null and coalesce(d.withdrawn_at, d.expires_at) < now() - interval '30 days'
     and not exists (select 1 from public.eradication_jobs j where j.consent_id = d.id and j.status in ('queued', 'running'));
  if not p_dry_run then
    delete from public.deletion_consents d
     where d.eradication_completed_at < now() - interval '12 months'
        or (d.eradication_completed_at is null and coalesce(d.withdrawn_at, d.expires_at) < now() - interval '30 days'
            and not exists (select 1 from public.eradication_jobs j where j.consent_id = d.id and j.status in ('queued', 'running')));
    get diagnostics n_deleted = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'completed_over_12_months', n_completed, 'abandoned_over_30_days', n_abandoned, 'deleted', n_deleted, 'ran_at', now());
end $$;

revoke all on function
  public.create_deletion_consent(uuid, text[], boolean, boolean, integer), public.eradication_start(uuid, text), public.eradication_begin(uuid),
  public.eradication_finish(uuid, boolean), public.withdraw_deletion_consent(uuid), public.mpt_purge_deletion_consents(boolean)
  from public, anon, authenticated;
grant execute on function
  public.create_deletion_consent(uuid, text[], boolean, boolean, integer), public.eradication_start(uuid, text), public.eradication_begin(uuid),
  public.eradication_finish(uuid, boolean), public.withdraw_deletion_consent(uuid), public.mpt_purge_deletion_consents(boolean)
  to service_role;

comment on function public.eradication_start(uuid, text) is 'MPC-8673. The gate: queues a job only for a consent that exists, is not withdrawn, is inside its 24h window and covers the category. Raises consent_not_found, consent_withdrawn, consent_expired, category_not_consented, job_already_started.';
comment on function public.mpt_purge_deletion_consents(boolean) is 'MPC-8673. Deletes consents 12 months after eradication completed, and unused (expired or withdrawn) consents 30 days after, unless a job is queued or running. Dry run by default. Counts only.';

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-deletion-consents';
    perform cron.schedule('mpt-purge-deletion-consents', '25 19 * * *', 'select public.mpt_purge_deletion_consents(false)');
  end if;
end $$;
