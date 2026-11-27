-- MPC-7556: delivery, bounce and complaint tracking for EVERY email type, with a per-email funnel. Counts only; no address is stored.
-- (The report email already records its furthest receipt on scans.delivery_status, CK-8503. This adds the same for every other email and the click count.)
--
--   public.email_sends: one row per email the provider accepted, written by the Worker's sendEmail() (best effort), keyed by the provider message id.
--     email_type = which email (confirm, report, followup, ...; see shared/email-map.js), is_test = sent to the owner's test mailbox (never counted in KPIs).
--     status = furthest provider event seen (ranked in SQL so late or repeated events never move it backwards); bounce_type = permanent | transient | undetermined;
--     click_count / first_click_at = clicks on tagged links (provider click events; no tracking pixels, open tracking must stay off).
--   public.mpt_record_email_event(): applies one signed webhook event atomically.
--   public.mpt_email_delivery_counts(from, to): per-email-type counts for a time window, test sends excluded. The daily collector calls it for the Hong Kong day and for a rolling 7 days.
--
-- Access: service_role only. anon/authenticated/public can neither read nor execute.
-- ROLLBACK: drop function if exists public.mpt_email_delivery_counts(timestamptz, timestamptz); drop function if exists public.mpt_record_email_event(text, text, timestamptz, text); drop table if exists public.email_sends;

create table if not exists public.email_sends (
  id                  uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique check (char_length(provider_message_id) between 1 and 200),
  email_type          text not null check (email_type ~ '^[a-z0-9-]{1,40}$'),
  is_test             boolean not null default false,
  sent_at             timestamptz not null default now(),
  status              text check (status in ('sent','delivery_delayed','delivered','bounced','failed','complained')),
  status_at           timestamptz,
  bounce_type         text check (bounce_type in ('permanent','transient','undetermined')),
  click_count         integer not null default 0 check (click_count >= 0),
  first_click_at      timestamptz
);
comment on table public.email_sends is 'MPC-7556. One row per email the provider accepted. No address, subject or body. service_role only.';
create index if not exists email_sends_sent_at_idx on public.email_sends (sent_at, email_type);

alter table public.email_sends enable row level security;
alter table public.email_sends force row level security;
revoke all on public.email_sends from public, anon, authenticated;
grant select, insert, update on public.email_sends to service_role;
drop policy if exists "service role full access" on public.email_sends;
create policy "service role full access" on public.email_sends for all to service_role using (true) with check (true);

-- Rank: later states win; a bad terminal outcome beats "delivered"; a complaint beats everything (same ranking as scans.delivery_status).
-- 'clicked' never changes status: it counts the click. Returns the number of rows changed (0 = unknown message id or no forward move).
create or replace function public.mpt_record_email_event(p_message_id text, p_status text, p_at timestamptz default now(), p_bounce_type text default null)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  new_rank int;
  n int;
begin
  if p_message_id is null or length(p_message_id) = 0 or length(p_message_id) > 200 then return 0; end if;
  if p_status = 'clicked' then
    update public.email_sends s set click_count = s.click_count + 1, first_click_at = coalesce(s.first_click_at, coalesce(p_at, now()))
     where s.provider_message_id = p_message_id;
    get diagnostics n = row_count;
    return n;
  end if;
  new_rank := case p_status when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 end;
  if new_rank is null then raise exception 'unknown email event status %', p_status using errcode = '22023'; end if;
  if p_bounce_type is not null and p_bounce_type not in ('permanent','transient','undetermined') then raise exception 'unknown bounce type %', p_bounce_type using errcode = '22023'; end if;
  update public.email_sends s
     set status = p_status, status_at = coalesce(p_at, now()),
         bounce_type = case when p_status = 'bounced' then coalesce(p_bounce_type, s.bounce_type) else s.bounce_type end
   where s.provider_message_id = p_message_id
     and new_rank > case coalesce(s.status, '') when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 else -1 end;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mpt_record_email_event(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.mpt_record_email_event(text, text, timestamptz, text) to service_role;

-- Per email type, for sends made in [p_from, p_to). delivered includes complained (a complaint means it arrived); bounced_hard = permanent bounces only.
create or replace function public.mpt_email_delivery_counts(p_from timestamptz, p_to timestamptz)
returns table (email_type text, sent bigint, delivered bigint, bounced bigint, bounced_hard bigint, complained bigint, clicked bigint)
language sql stable security invoker set search_path = public as $$
  select s.email_type,
         count(*)                                                                         as sent,
         count(*) filter (where s.status in ('delivered','complained'))                   as delivered,
         count(*) filter (where s.status in ('bounced','failed'))                          as bounced,
         count(*) filter (where s.status = 'bounced' and s.bounce_type = 'permanent')      as bounced_hard,
         count(*) filter (where s.status = 'complained')                                   as complained,
         count(*) filter (where s.click_count > 0)                                         as clicked
    from public.email_sends s
   where s.sent_at >= p_from and s.sent_at < p_to and not s.is_test
   group by s.email_type
   order by s.email_type;
$$;
revoke all on function public.mpt_email_delivery_counts(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mpt_email_delivery_counts(timestamptz, timestamptz) to service_role;
