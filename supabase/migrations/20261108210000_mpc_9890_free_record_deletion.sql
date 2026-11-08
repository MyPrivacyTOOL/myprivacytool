-- MPC-9890 (Open Tracker design 4.1, 4.2, 8.4): a free user's personal record is deleted N hours after the report is delivered, unless the person chose a relationship.
--
-- Decisions that govern (Chris, 2026-11-08, design page section 0): N = 7 days (168 h; DECIDED 2 revised); "keep my scan" / sign-up is the explicit keep action;
-- countdown emails at T-24 h, T-4 h and T-0 with one-click Keep / Sign up (sent by the scan-report Worker, which also sends the T-0 mail AFTER the deletion from the
-- address list this migration's function returns, so the address is never stored after the deadline).
--
-- 1. scans.delete_after            the deadline. Set by trigger: delivered receipt -> delivered time + N; otherwise report_sent_at + N (a later delivered receipt moves it
--                                  later, never earlier). NULL = no deadline = kept. N is the one the person consented to (scan_consents.n_hours via scans.consent_id),
--                                  else public.free_record_policy.n_hours (168; must equal CONSENT_CONFIG.n_hours, pinned by a test).
--    scans.kept_at                 the explicit keep action (one-click Keep link). Kept, signed-up (accounts / account_scans) and paid rows are never on the deletion path.
--    scans.countdown_24h_sent_at / countdown_4h_sent_at   claim marks so each countdown email goes out once.
-- 2. public.mpt_purge_free_records(p_dry_run, p_overdue)   deletes, in ONE transaction, scan_consents, web_scans (+ web_scan_contacts, listing checks, events: cascade), scans
--                                  (+ signals, hexagon_scores: cascade), leads, users (never signed up), scan_recipient_log and the ledger record of the person. Calls the
--                                  aggregate hook (public.mpt_aggregate_before_delete, MPC-9892 replaces its body) inside the same transaction BEFORE the delete.
--                                  Returns COUNTS plus the addresses of the deleted records (`notify`) so the Worker can send the T-0 mail and delete the HubSpot contact.
-- 3. AFTER DELETE triggers on web_scans and scans remove scan_consents and scan_recipient_log, so EVERY deletion path (retention purge, by scan number, DSAR, account delete)
--    takes the consent and the who-saw-what rows with the scan. After deletion only the per-consent_version count remains (scan_consent_counts, MPC-9887).
-- 4. public.mpt_keep_scan(p_scans_id), public.mpt_claim_deletion_notices(p_limit), public.mpt_release_deletion_notice(...)  for the Worker.
-- 5. CK-9848 interim purge mpt_purge_expired_scans() is replaced by a delegate: it deleted linked (kept) scans, because expires_at = NULL was read as created_at + 30 days.
-- 6. pg_cron: hourly backstop mpt-purge-free-records (only rows more than 1 hour overdue, so the Worker's own 5-minute run, which sends the T-0 mail, normally wins).
--
-- service_role only. Counts-only log (public.free_record_deletion_log). Rollback at the bottom. Irreversible once rows are deleted: run mpt_purge_free_records(true) first.

-- ---------------------------------------------------------------- policy and log
create table if not exists public.free_record_policy (
  id        boolean primary key default true check (id),
  n_hours   integer not null default 168 check (n_hours between 1 and 8760),
  updated_at timestamptz not null default now()
);
insert into public.free_record_policy (id, n_hours) values (true, 168) on conflict (id) do nothing;
comment on table public.free_record_policy is 'MPC-9890. Single row: N hours from report delivery to deletion of a free user''s record, used when a scan has no stored consent. Must equal CONSENT_CONFIG.n_hours (shared/recipients/consent-config.ts); a test pins it.';

create table if not exists public.free_record_deletion_log (
  id             bigint generated always as identity primary key,
  logged_at      timestamptz not null default now(),
  kind           text not null check (kind in ('purge', 'purge_dry_run')),
  scans_deleted  integer not null check (scans_deleted >= 0),
  web_scans_deleted integer not null default 0,
  users_deleted  integer not null default 0,
  leads_deleted  integer not null default 0,
  ledger_persons integer not null default 0,
  note           text
);
comment on table public.free_record_deletion_log is 'MPC-9890. One row per free-record purge run. Counts only: no address, scan number or value.';

alter table public.free_record_policy enable row level security;
alter table public.free_record_policy force row level security;
alter table public.free_record_deletion_log enable row level security;
alter table public.free_record_deletion_log force row level security;
revoke all on public.free_record_policy, public.free_record_deletion_log from public, anon, authenticated;
grant all on public.free_record_policy, public.free_record_deletion_log to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'free_record_policy' and policyname = 'service role full access') then
    create policy "service role full access" on public.free_record_policy for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'free_record_deletion_log' and policyname = 'service role full access') then
    create policy "service role full access" on public.free_record_deletion_log for all to service_role using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------- deadline columns and trigger
alter table public.scans
  add column if not exists delete_after timestamptz,
  add column if not exists kept_at timestamptz,
  add column if not exists countdown_24h_sent_at timestamptz,
  add column if not exists countdown_4h_sent_at timestamptz;
create index if not exists scans_delete_after_idx on public.scans (delete_after) where delete_after is not null;
comment on column public.scans.delete_after is 'MPC-9890. When this free record is deleted: delivered receipt time (else report_sent_at) + N hours. NULL = kept, or no report sent yet.';
comment on column public.scans.kept_at is 'MPC-9890. The person pressed Keep (one-click link in the report or countdown email). Never on the deletion path.';

create or replace function public.mpt_scan_is_kept(p_scan public.scans) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_scan.kept_at is not null
      or exists (select 1 from public.account_scans l where l.scans_id = p_scan.id)
      or exists (select 1 from public.accounts a where a.email = lower(p_scan.email_scanned));
$$;

create or replace function public.mpt_scans_set_delete_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; base timestamptz;
begin
  if new.kept_at is not null then new.delete_after := null; return new; end if;
  if new.report_sent_at is null then return new; end if;
  select c.n_hours into n from public.scan_consents c where c.id = new.consent_id;
  if n is null then select p.n_hours into n from public.free_record_policy p where p.id; end if;
  n := coalesce(n, 168);
  base := case when new.delivery_status = 'delivered' and new.delivery_status_at is not null then new.delivery_status_at else new.report_sent_at end;
  -- never earlier than a deadline already promised (a late "delivered" receipt moves it later; nothing moves it earlier)
  new.delete_after := greatest(base + make_interval(hours => n), coalesce(new.delete_after, '-infinity'::timestamptz));
  return new;
end $$;
revoke all on function public.mpt_scans_set_delete_after(), public.mpt_scan_is_kept(public.scans) from public, anon, authenticated;

drop trigger if exists scans_set_delete_after on public.scans;
create trigger scans_set_delete_after before insert or update of report_sent_at, delivery_status, delivery_status_at, kept_at, consent_id on public.scans
  for each row execute function public.mpt_scans_set_delete_after();

-- Reports already sent before this migration: a FRESH window of N hours from now (not report_sent_at + N, which would delete older records at the first tick with no notice),
-- so every existing free record gets the full countdown emails first. Direct update of delete_after does not fire the trigger. Nothing is deleted here.
update public.scans set delete_after = now() + make_interval(hours => (select n_hours from public.free_record_policy where id))
 where report_sent_at is not null and delete_after is null and kept_at is null;

-- ---------------------------------------------------------------- the consent and the who-saw-what rows go with the scan, on every deletion path
create or replace function public.mpt_web_scans_delete_children() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.scan_consents where scan_id = old.id;        -- the per-version count trigger keeps the only trace (MPC-9887)
  delete from public.scan_recipient_log where scan_id = old.id::text;
  return old;
end $$;
revoke all on function public.mpt_web_scans_delete_children() from public, anon, authenticated;
drop trigger if exists web_scans_delete_children on public.web_scans;
create trigger web_scans_delete_children after delete on public.web_scans for each row execute function public.mpt_web_scans_delete_children();

create or replace function public.mpt_scans_delete_children() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.scan_recipient_log where scan_id = old.id::text;
  if old.consent_id is not null then delete from public.scan_consents where id = old.consent_id; end if;
  return old;
end $$;
revoke all on function public.mpt_scans_delete_children() from public, anon, authenticated;
drop trigger if exists scans_delete_children on public.scans;
create trigger scans_delete_children after delete on public.scans for each row execute function public.mpt_scans_delete_children();

-- ---------------------------------------------------------------- the aggregate hook (MPC-9892 replaces the body; created only if absent)
do $$ begin
  if to_regprocedure('public.mpt_aggregate_before_delete(uuid[])') is null then
    execute $f$create function public.mpt_aggregate_before_delete(p_web_scans uuid[]) returns void language sql security definer set search_path = public, pg_temp as 'select 1'$f$;
    execute 'revoke all on function public.mpt_aggregate_before_delete(uuid[]) from public, anon, authenticated';
    execute 'comment on function public.mpt_aggregate_before_delete(uuid[]) is ''MPC-9890 placeholder. MPC-9892 replaces the body with the counter-only anonymised aggregate. Called inside the deletion transaction, before the delete, with the saved scan numbers.''';
  end if;
end $$;

-- ---------------------------------------------------------------- the purge
create or replace function public.mpt_purge_free_records(p_dry_run boolean default false, p_overdue interval default interval '0')
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  ids uuid[]; webs uuid[]; users_ uuid[]; emails text[]; lp uuid[] := '{}'; p uuid;
  n_scans int := 0; n_web int := 0; n_users int := 0; n_leads int := 0; n_ledger int := 0; hashes text[];
begin
  select coalesce(array_agg(s.id), '{}'), coalesce(array_agg(distinct lower(s.email_scanned)), '{}'), coalesce(array_agg(distinct s.user_id) filter (where s.user_id is not null), '{}')
    into ids, emails, users_
    from public.scans s
   where s.delete_after is not null and s.delete_after <= now() - p_overdue and not public.mpt_scan_is_kept(s);
  select coalesce(array_agg(distinct c.web_scan_id), '{}') into webs from public.web_scan_contacts c where c.channel = 'email' and c.contact_id = any(ids);

  if p_dry_run then
    n_scans := cardinality(ids); n_web := cardinality(webs);
    select count(*) into n_users from public.users u where u.id = any(users_)
       and not exists (select 1 from public.scans s2 where s2.user_id = u.id and not (s2.id = any(ids)))
       and not exists (select 1 from public.accounts a where a.email = lower(u.email));
    insert into public.free_record_deletion_log (kind, scans_deleted, web_scans_deleted, users_deleted, note) values ('purge_dry_run', n_scans, n_web, n_users, format('N from consent, default %s', (select n_hours from public.free_record_policy where id)));
    return jsonb_build_object('dry_run', true, 'scans', n_scans, 'web_scans', n_web, 'users', n_users, 'ran_at', now());
  end if;
  if cardinality(ids) = 0 then return jsonb_build_object('dry_run', false, 'scans', 0, 'web_scans', 0, 'users', 0, 'leads', 0, 'ledger_persons', 0, 'notify', '[]'::jsonb, 'ran_at', now()); end if;

  -- MPC-9892: counter-only aggregate, inside this transaction, before anything is deleted. Only counters leave; no per-scan row is kept.
  perform public.mpt_aggregate_before_delete(webs);

  -- the person's ledger record (MPC-8737 M3 pattern): find it by the identifiers it had BEFORE the rows disappear
  if to_regprocedure('ledger.erase_person(uuid)') is not null then
    select coalesce(array_agg(distinct encode(digest(e, 'sha256'), 'hex')), '{}') into hashes from unnest(emails) e;
    select coalesce(array_agg(distinct ledger.root_person(pi.person_id)), '{}') into lp
      from ledger.person_identifier pi
     where (pi.id_type = 'email_hash' and pi.id_value = any(hashes))
        or (pi.id_type = 'user_id' and pi.id_value in (select u.id::text from public.users u where u.id = any(users_)))
        or (pi.id_type = 'lead_id' and pi.id_value in (select l.id::text from public.leads l where l.user_id = any(users_)))
        or (pi.id_type = 'scan_id' and pi.id_value in (select unnest(ids)::text))
        or (pi.id_type = 'web_scan_id' and pi.id_value in (select unnest(webs)::text));
  end if;

  delete from public.web_scans where id = any(webs);                       get diagnostics n_web = row_count;     -- cascades to contacts; trigger removes consents and recipient log
  delete from public.scans where id = any(ids);                            get diagnostics n_scans = row_count;   -- cascades to signals, hexagon_scores
  -- a user who never signed up, with no scan left: the user row and the lead rows go; anyone with an account, or another live scan, stays
  with gone as (
    delete from public.users u where u.id = any(users_)
       and not exists (select 1 from public.scans s2 where s2.user_id = u.id)
       and not exists (select 1 from public.accounts a where a.email = lower(u.email))
    returning u.id)
  select count(*), coalesce(array_agg(id), '{}') into n_users, users_ from gone;
  delete from public.leads l where l.user_id = any(users_) or (l.user_id is null and lower(l.email) = any(emails)
       and not exists (select 1 from public.accounts a where a.email = lower(l.email)) and not exists (select 1 from public.scans s3 where lower(s3.email_scanned) = lower(l.email)));
  get diagnostics n_leads = row_count;
  foreach p in array lp loop perform ledger.erase_person(p); n_ledger := n_ledger + 1; end loop;

  insert into public.free_record_deletion_log (kind, scans_deleted, web_scans_deleted, users_deleted, leads_deleted, ledger_persons, note)
  values ('purge', n_scans, n_web, n_users, n_leads, n_ledger, format('overdue >= %s', p_overdue));
  return jsonb_build_object('dry_run', false, 'scans', n_scans, 'web_scans', n_web, 'users', n_users, 'leads', n_leads, 'ledger_persons', n_ledger,
                            'notify', to_jsonb(emails), 'ran_at', now());
end $$;

-- CK-9848's interim purge deleted kept scans (expires_at NULL was read as created_at + 30 days). It now delegates, and its cron job is replaced below.
create or replace function public.mpt_purge_expired_scans(p_dry_run boolean default false)
returns jsonb language sql security definer set search_path = public, pg_temp as $$ select public.mpt_purge_free_records(p_dry_run) $$;

-- ---------------------------------------------------------------- keep, and the countdown emails
create or replace function public.mpt_keep_scan(p_scans_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.scans set kept_at = coalesce(kept_at, now()), delete_after = null where id = p_scans_id and report_sent_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('kept', n > 0);
end $$;

-- Claims the next countdown emails atomically (each stage at most once). T-24 h: delete_after within 24 h. T-4 h: within 4 h (a scan that reaches 4 h first skips the 24 h mail).
create or replace function public.mpt_claim_deletion_notices(p_limit int default 20)
returns table (scans_id uuid, email text, stage text, delete_after timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select s.id, case when s.delete_after - now() <= interval '4 hours' then '4h' else '24h' end as st
      from public.scans s
     where s.delete_after is not null and s.delete_after > now() and s.delete_after - now() <= interval '24 hours'
       and not public.mpt_scan_is_kept(s)
       and ((s.delete_after - now() <= interval '4 hours' and s.countdown_4h_sent_at is null) or (s.delete_after - now() > interval '4 hours' and s.countdown_24h_sent_at is null))
     order by s.delete_after limit greatest(1, least(p_limit, 100)) for update skip locked)
  update public.scans s set
         countdown_4h_sent_at  = case when d.st = '4h' then now() else s.countdown_4h_sent_at end,
         countdown_24h_sent_at = coalesce(s.countdown_24h_sent_at, now())
    from due d where s.id = d.id
  returning s.id, s.email_scanned, d.st, s.delete_after;
end $$;

create or replace function public.mpt_release_deletion_notice(p_scans_id uuid, p_stage text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.scans set countdown_4h_sent_at = case when p_stage = '4h' then null else countdown_4h_sent_at end,
                          countdown_24h_sent_at = case when p_stage = '24h' then null else countdown_24h_sent_at end
   where id = p_scans_id;
$$;

revoke all on function public.mpt_purge_free_records(boolean, interval), public.mpt_purge_expired_scans(boolean), public.mpt_keep_scan(uuid),
  public.mpt_claim_deletion_notices(int), public.mpt_release_deletion_notice(uuid, text) from public, anon, authenticated;
grant execute on function public.mpt_purge_free_records(boolean, interval), public.mpt_purge_expired_scans(boolean), public.mpt_keep_scan(uuid),
  public.mpt_claim_deletion_notices(int), public.mpt_release_deletion_notice(uuid, text) to service_role;
comment on function public.mpt_purge_free_records(boolean, interval) is 'MPC-9890. Deletes free records past scans.delete_after (not kept, not signed up, not paid) in one transaction and returns counts plus the deleted addresses (notify) for the T-0 email and HubSpot delete. service_role only.';

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('mpt-purge-expired-scans') where exists (select 1 from cron.job where jobname = 'mpt-purge-expired-scans');
    perform cron.schedule('mpt-purge-free-records', '7 * * * *', $c$select public.mpt_purge_free_records(false, interval '1 hour')$c$);
  end if;
end $$;

-- ROLLBACK
--   select cron.unschedule('mpt-purge-free-records');   -- if pg_cron is present; then re-create 'mpt-purge-expired-scans' from 20261108060000_ck_9848_scans_retention_purge.sql
--   drop trigger if exists scans_set_delete_after on public.scans; drop trigger if exists web_scans_delete_children on public.web_scans; drop trigger if exists scans_delete_children on public.scans;
--   drop function if exists public.mpt_purge_free_records(boolean, interval), public.mpt_keep_scan(uuid), public.mpt_claim_deletion_notices(int), public.mpt_release_deletion_notice(uuid, text),
--     public.mpt_scans_set_delete_after(), public.mpt_web_scans_delete_children(), public.mpt_scans_delete_children(), public.mpt_scan_is_kept(public.scans);
--   alter table public.scans drop column if exists delete_after, drop column if exists kept_at, drop column if exists countdown_24h_sent_at, drop column if exists countdown_4h_sent_at;
--   drop table if exists public.free_record_deletion_log, public.free_record_policy;
--   (then re-create public.mpt_purge_expired_scans(boolean) from the CK-9848 migration)
