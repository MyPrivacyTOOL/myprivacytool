-- CK-8503: two small, additive changes to the scan request lifecycle. Nothing is dropped or rewritten; no existing row changes.
--
-- 1. Delivery receipts (gap G4). scans.resend_message_id only proves the provider ACCEPTED the report email. Resend can also tell us
--    delivered / bounced / complained / delayed (signed webhook, workers/scan-report/lib/receipts.js, OFF until RESEND_WEBHOOK_SECRET is set).
--    scans.delivery_status keeps the furthest state seen, so a late or repeated event can never move it backwards.
--    public.mpt_record_email_receipt() applies one event atomically (ranked in SQL, no read-modify-write in the Worker).
-- 2. Atomic "one scan per address per 24h" (gap G5). The Worker used to check then insert, so simultaneous requests all passed the
--    check. public.mpt_request_scan() takes a per-user advisory lock, then checks and inserts in one transaction. The Worker falls back
--    to the old two-step path while this function does not exist, so deploy order does not matter.
--
-- Access: service_role only (the scan-report Worker). anon/authenticated/public cannot execute either function.
--
-- ROLLBACK (leaves scans exactly as before):
--   drop function if exists public.mpt_request_scan(uuid, text, uuid, interval);
--   drop function if exists public.mpt_record_email_receipt(text, text, timestamptz);
--   drop index if exists public.scans_resend_message_id_idx;
--   alter table public.scans drop column if exists delivery_status_at, drop column if exists delivery_status;

alter table public.scans
  add column if not exists delivery_status    text check (delivery_status in ('sent','delivery_delayed','delivered','bounced','failed','complained')),
  add column if not exists delivery_status_at timestamptz;

create index if not exists scans_resend_message_id_idx on public.scans (resend_message_id) where resend_message_id is not null;

comment on column public.scans.delivery_status    is 'CK-8503: furthest provider receipt seen for the report email (Resend webhook). NULL = no receipt received (not the same as not delivered). Only set via mpt_record_email_receipt().';
comment on column public.scans.delivery_status_at is 'CK-8503: provider timestamp of the event that set delivery_status.';

-- Rank: later states win, a terminal bad outcome beats "delivered", a complaint beats everything.
create or replace function public.mpt_record_email_receipt(p_message_id text, p_status text, p_at timestamptz default now())
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  new_rank int;
  n int;
begin
  new_rank := case p_status when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 end;
  if new_rank is null then raise exception 'unknown receipt status %', p_status using errcode = '22023'; end if;
  if p_message_id is null or length(p_message_id) = 0 or length(p_message_id) > 200 then return 0; end if;
  update public.scans s
     set delivery_status = p_status, delivery_status_at = coalesce(p_at, now())
   where s.resend_message_id = p_message_id
     and new_rank > case coalesce(s.delivery_status, '') when 'sent' then 0 when 'delivery_delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 else -1 end;
  get diagnostics n = row_count;
  return n;
end $$;

-- One scan per user per window. Returns the existing scan (duplicate = true) or the new one (duplicate = false), plus that scan's request_id
-- (MPC-7471-F3: lets the Worker tell a visitor's own retry from someone else). request_id is read through to_jsonb() and written with dynamic SQL
-- only when one is supplied, so this function also works while scans.request_id (F3's migration) does not exist yet.
create or replace function public.mpt_request_scan(p_user_id uuid, p_email text, p_request_id uuid default null, p_window interval default interval '24 hours')
returns table (scan_id uuid, duplicate boolean, request_id text)
language plpgsql security invoker set search_path = public as $$
declare
  existing uuid;
  existing_request text;
  created uuid;
begin
  if p_window < interval '1 minute' or p_window > interval '7 days' then raise exception 'window out of range' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mpt_request_scan:' || p_user_id::text, 0));   -- concurrent requests for one user queue here; the next one sees the first insert
  select s.id, to_jsonb(s) ->> 'request_id' into existing, existing_request
    from public.scans s where s.user_id = p_user_id and s.created_at >= now() - p_window order by s.created_at asc, s.id asc limit 1;
  if existing is not null then
    return query select existing, true, existing_request;
    return;
  end if;
  if p_request_id is null then
    insert into public.scans (user_id, email_scanned, source) values (p_user_id, p_email, 'web_scan') returning id into created;
  else
    execute 'insert into public.scans (user_id, email_scanned, source, request_id) values ($1, $2, ''web_scan'', $3) returning id' into created using p_user_id, p_email, p_request_id;
  end if;
  return query select created, false, p_request_id::text;
end $$;

revoke all on function public.mpt_record_email_receipt(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mpt_request_scan(uuid, text, uuid, interval) from public, anon, authenticated;
grant execute on function public.mpt_record_email_receipt(text, text, timestamptz) to service_role;
grant execute on function public.mpt_request_scan(uuid, text, uuid, interval) to service_role;
