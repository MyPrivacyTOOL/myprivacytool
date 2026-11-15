-- MPC-9818 (F3): plan entitlements as DATA and monthly scan allowances per plan. No Stripe (MPC-9819), no prices here.
--
-- Decisions that govern (Chris, 2026-11-07): scans per month Free 1 / Basic 5 / Pro 25 / Executive unlimited (NULL = no cap, no fair-use text);
-- Option A (full report from Basic); the pricing principle (a check MPT pays a third party for is never Free); no redaction anywhere.
-- Spec: "MPT > Paid Exposure Report - Spec (F2, v1)" sections 3 and 7 (repo copy docs/paid-report-spec-mpc-9815.md in krispyking/openclaw26).
--
--   part A  capability_min_tier        all 20 spec rows (the 6 free rows from MPC-9817 are re-asserted, not changed)
--   part B  plan_scan_allowance        scans per calendar month per plan (NULL = unlimited)
--   part C  scan_consumption           one row per counted scan, idempotent on the scan number; keyed by a HASH of the confirmed email (no address, no IP)
--   part D  functions                  mpt_scan_period, mpt_consume_scan, mpt_confirm_scan_consumption, mpt_get_entitlements, mpt_set_plan (service_role only)
--   part E  account_plan_log           audit of every plan change made by mpt_set_plan (manual grants now, the Stripe webhook in MPC-9819)
--
-- Additive and idempotent; deletes nothing that exists. Safe to apply before the Worker change (SCAN_ALLOWANCE_ENABLED stays off until the Worker ships with it).
-- Rollback:
--   drop function if exists public.mpt_set_plan(uuid, text, text), public.mpt_get_entitlements(uuid, text), public.mpt_confirm_scan_consumption(uuid),
--     public.mpt_consume_scan(uuid, text, boolean, uuid), public.mpt_scan_period();
--   drop table if exists public.account_plan_log, public.scan_consumption, public.plan_scan_allowance;
--   delete from public.capability_min_tier where key not in ('scan.browser_hexagons','scan.email_checks','report.score','report.hexagon_guides','report.optout_guides','broker.listing_check_pasted');

-- ================================================================ part A: the 20 entitlement rows
insert into public.capability_min_tier (key, min_tier, cost, status, note) values
  ('scan.browser_hexagons',       'free',      null,          'live',    null),
  ('scan.email_checks',           'free',      null,          'live',    null),
  ('report.score',                'free',      null,          'live',    null),
  ('report.hexagon_guides',       'free',      null,          'live',    null),
  ('report.optout_guides',        'free',      null,          'live',    null),
  ('broker.listing_check_pasted', 'free',      'none',        'live',    null),
  ('broker.licensed_lookup',      'basic',     'third_party', 'planned', 'licensed vendor not chosen (MPC-9846)'),
  ('report.broker_section_full',  'basic',     null,          'planned', 'nine brokers listed / not listed / not checked, with proof'),
  ('breach.check',                'basic',     'third_party', 'planned', null),
  ('report.breach_section',       'basic',     null,          'planned', null),
  ('report.history_full',         'basic',     null,          'live',    'every scan inside retention; Free sees the latest only'),
  ('report.export_pdf',           'basic',     null,          'planned', 'MPC-9816'),
  ('report.export_json',          'basic',     null,          'planned', 'MPC-9816'),
  ('journey.memory',              'basic',     null,          'planned', 'step 1 is live'),
  ('alice.email_reply',           'basic',     null,          'planned', null),
  ('family.seat_report',          'basic',     null,          'planned', 'proposal'),
  ('watch.auto_monthly_rescan',   'pro',       null,          'planned', null),
  ('watch.alerts',                'pro',       null,          'planned', null),
  ('action.removal_requests',     'pro',       null,          'planned', 'F4, MPC-9821'),
  ('action.managed_removal',      'executive', null,          'planned', 'MPC-8656 programme')
on conflict (key) do update set min_tier = excluded.min_tier, cost = excluded.cost, status = excluded.status, note = excluded.note;
comment on table public.capability_min_tier is 'MPC-9817/9818. Entitlement data from the Paid Exposure Report spec section 3: one row per capability, the lowest tier that has it (order free < basic < pro < executive). 20 rows. Changing a threshold is a data change, not a deploy. Unknown keys are denied by mpt_can. A third_party-cost row can never be free (check constraint).';

-- ================================================================ part B: scan allowance per plan
create table if not exists public.plan_scan_allowance (
  plan       text primary key check (plan in ('free', 'basic', 'pro', 'executive')),
  per_month  integer check (per_month is null or per_month > 0),       -- NULL = unlimited (decided 2026-11-07: no cap, no fair-use text)
  updated_at timestamptz not null default now()
);
comment on table public.plan_scan_allowance is 'MPC-9818. Scans per calendar month (UTC) per plan; NULL = unlimited. Decided by Chris 2026-11-07: Free 1, Basic 5, Pro 25, Executive unlimited. /pricing and enforcement read the same numbers.';
alter table public.plan_scan_allowance enable row level security;
alter table public.plan_scan_allowance force row level security;
revoke all on public.plan_scan_allowance from public, anon, authenticated;
grant all on public.plan_scan_allowance to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_scan_allowance' and policyname = 'service role full access') then
    create policy "service role full access" on public.plan_scan_allowance for all to service_role using (true) with check (true);
  end if;
end $$;
insert into public.plan_scan_allowance (plan, per_month) values ('free', 1), ('basic', 5), ('pro', 25), ('executive', null)
on conflict (plan) do update set per_month = excluded.per_month, updated_at = now();

-- ================================================================ part C: the counter
create table if not exists public.scan_consumption (
  scan_id      uuid primary key,                                                   -- public.scans.id of the email request; no foreign key (scans purge on their own clock)
  subject_key  text not null check (subject_key ~ '^[0-9a-f]{64}$'),               -- sha256(lower(email)): the allowance follows the confirmed email, signed in or not. No address stored.
  plan         text not null check (plan in ('free', 'basic', 'pro', 'executive')),
  period_start date not null,                                                      -- first day of the calendar month (UTC) the scan counts in
  consumed_at  timestamptz not null default now(),
  confirmed_at timestamptz                                                         -- set when the inbox owner presses the confirm button; an unconfirmed scan counts for 24 hours only
);
create index if not exists scan_consumption_subject_idx on public.scan_consumption (subject_key, period_start);
comment on table public.scan_consumption is 'MPC-9818. One row per scan counted against a monthly allowance. subject_key is a hash of the lower-cased email, so typing someone else''s address cannot use up their allowance for more than 24 hours (an unconfirmed scan stops counting then). No email, no IP. Rows older than 100 days are purged by mpt_consume_scan.';
alter table public.scan_consumption enable row level security;
alter table public.scan_consumption force row level security;
revoke all on public.scan_consumption from public, anon, authenticated;
grant all on public.scan_consumption to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scan_consumption' and policyname = 'service role full access') then
    create policy "service role full access" on public.scan_consumption for all to service_role using (true) with check (true);
  end if;
end $$;

-- ================================================================ part E (created before the functions that write to it): the plan-change audit
create table if not exists public.account_plan_log (
  id         bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  old_plan   text not null,
  new_plan   text not null,
  reason     text not null check (char_length(reason) between 3 and 200),
  changed_at timestamptz not null default now()
);
comment on table public.account_plan_log is 'MPC-9818. Every plan change made through mpt_set_plan (manual grant, or the Stripe webhook in MPC-9819). Deleted with the account. No IP, no payment data.';
alter table public.account_plan_log enable row level security;
alter table public.account_plan_log force row level security;
revoke all on public.account_plan_log from public, anon, authenticated;
grant all on public.account_plan_log to service_role;
grant usage, select on sequence public.account_plan_log_id_seq to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_plan_log' and policyname = 'service role full access') then
    create policy "service role full access" on public.account_plan_log for all to service_role using (true) with check (true);
  end if;
end $$;

-- ================================================================ part D: functions (service_role only)
create or replace function public.mpt_scan_period() returns date
language sql stable as $$ select (date_trunc('month', now() at time zone 'UTC'))::date $$;

-- Counts one scan against the allowance of the plan that owns the (confirmed) email. Idempotent on p_scan: a retry returns the same answer and never counts twice.
-- p_confirmed = true when no click-to-confirm gate is on (the scan counts at once); otherwise the click calls mpt_confirm_scan_consumption.
-- An account's plan wins; an address with no account is Free. Refusal inserts nothing.
create or replace function public.mpt_consume_scan(p_scan uuid, p_email text, p_confirmed boolean default false, p_account uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text; v_plan text; v_limit int; v_unlimited boolean; v_used int; v_period date := public.mpt_scan_period();
  v_resets timestamptz := ((public.mpt_scan_period() + interval '1 month')::timestamp at time zone 'UTC');
  v_next text; v_next_limit int; v_existing public.scan_consumption;
begin
  if p_scan is null or v_email = '' then raise exception 'scan and email required' using errcode = '22023'; end if;
  v_key := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  delete from public.scan_consumption where consumed_at < now() - interval '100 days';
  select a.plan into v_plan from public.accounts a where (p_account is not null and a.id = p_account) or (p_account is null and a.email = v_email) limit 1;
  v_plan := coalesce(v_plan, 'free');
  select per_month, per_month is null into v_limit, v_unlimited from public.plan_scan_allowance where plan = v_plan;
  if not found then select per_month, per_month is null into v_limit, v_unlimited from public.plan_scan_allowance where plan = 'free'; v_plan := 'free'; end if;
  select * into v_existing from public.scan_consumption where scan_id = p_scan;
  select count(*) into v_used from public.scan_consumption
   where subject_key = v_key and period_start = v_period and scan_id <> p_scan and (confirmed_at is not null or consumed_at > now() - interval '24 hours');
  if v_existing.scan_id is not null then
    return jsonb_build_object('allowed', true, 'already', true, 'plan', v_existing.plan, 'limit', v_limit, 'used', v_used + 1,
                              'remaining', case when v_unlimited then null else greatest(v_limit - v_used - 1, 0) end, 'resets_at', v_resets);
  end if;
  if not v_unlimited and v_used >= v_limit then
    select plan, per_month into v_next, v_next_limit from public.plan_scan_allowance
     where public.mpt_tier_rank(plan) = public.mpt_tier_rank(v_plan) + 1;
    return jsonb_build_object('allowed', false, 'plan', v_plan, 'limit', v_limit, 'used', v_used, 'remaining', 0, 'resets_at', v_resets,
                              'upgrade', case when v_next is null then null else jsonb_build_object('plan', v_next, 'per_month', v_next_limit, 'unlimited', v_next_limit is null) end);
  end if;
  insert into public.scan_consumption (scan_id, subject_key, plan, period_start, confirmed_at)
  values (p_scan, v_key, v_plan, v_period, case when p_confirmed then now() end) on conflict (scan_id) do nothing;
  return jsonb_build_object('allowed', true, 'already', false, 'plan', v_plan, 'limit', v_limit, 'used', v_used + 1,
                            'remaining', case when v_unlimited then null else v_limit - v_used - 1 end, 'resets_at', v_resets);
end $$;

-- The click-to-confirm proved the inbox: from now the scan counts for the whole month. Idempotent; false when there is no counted scan with that number.
create or replace function public.mpt_confirm_scan_consumption(p_scan uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.scan_consumption set confirmed_at = coalesce(confirmed_at, now()) where scan_id = p_scan;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Everything the report and the account page need in one call: tier, every capability as allowed / not, the scan limit and what is left this month.
-- Give the account, or just the (confirmed) email the report goes to; neither => Free. plan_status / period_end arrive with the Stripe webhook (MPC-9819).
create or replace function public.mpt_get_entitlements(p_account uuid default null, p_email text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), ''); a public.accounts; v_plan text := 'free'; v_has boolean := false;
  v_limit int; v_unlimited boolean := false; v_used int := 0; v_key text; v_period date := public.mpt_scan_period(); caps jsonb; mins jsonb;
begin
  select * into a from public.accounts where (p_account is not null and id = p_account) or (p_account is null and v_email is not null and email = v_email) limit 1;
  if a.id is not null then v_plan := a.plan; v_has := true; v_email := coalesce(v_email, a.email); end if;
  select per_month, per_month is null into v_limit, v_unlimited from public.plan_scan_allowance where plan = v_plan;
  select jsonb_object_agg(key, public.mpt_tier_rank(v_plan) >= public.mpt_tier_rank(min_tier)),
         jsonb_object_agg(key, jsonb_build_object('min_tier', min_tier, 'status', status, 'cost', cost))
    into caps, mins from public.capability_min_tier;
  if v_email is not null then
    v_key := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
    select count(*) into v_used from public.scan_consumption where subject_key = v_key and period_start = v_period and (confirmed_at is not null or consumed_at > now() - interval '24 hours');
  end if;
  return jsonb_build_object('tier', v_plan, 'has_account', v_has, 'capabilities', coalesce(caps, '{}'::jsonb), 'capability_info', coalesce(mins, '{}'::jsonb),
    'limits', jsonb_build_object('scan.per_month', v_limit),
    'scans', jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', case when v_unlimited then null else greatest(v_limit - v_used, 0) end, 'unlimited', v_unlimited,
                                'period_start', v_period, 'resets_at', ((v_period + interval '1 month')::timestamp at time zone 'UTC')));
end $$;

-- Admin override: the plan can be set by service role only (manual grant, and the Stripe webhook in MPC-9819). No UI. Idempotent: setting the plan it already has changes nothing.
create or replace function public.mpt_set_plan(p_account uuid, p_plan text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  if p_plan is null or public.mpt_tier_rank(p_plan) is null then raise exception 'unknown plan' using errcode = '22023'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  select plan into v_old from public.accounts where id = p_account for update;
  if v_old is null then return jsonb_build_object('changed', false, 'reason', 'no_account'); end if;
  if v_old = p_plan then return jsonb_build_object('changed', false, 'plan', v_old, 'reason', 'already'); end if;
  update public.accounts set plan = p_plan where id = p_account;
  insert into public.account_plan_log (account_id, old_plan, new_plan, reason) values (p_account, v_old, p_plan, left(trim(p_reason), 200));
  return jsonb_build_object('changed', true, 'old_plan', v_old, 'plan', p_plan);
end $$;

revoke all on function public.mpt_scan_period(), public.mpt_consume_scan(uuid, text, boolean, uuid), public.mpt_confirm_scan_consumption(uuid),
  public.mpt_get_entitlements(uuid, text), public.mpt_set_plan(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mpt_scan_period(), public.mpt_consume_scan(uuid, text, boolean, uuid), public.mpt_confirm_scan_consumption(uuid),
  public.mpt_get_entitlements(uuid, text), public.mpt_set_plan(uuid, text, text) to service_role;
