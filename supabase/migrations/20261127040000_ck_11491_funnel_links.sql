-- CK-11491: make the free-scan funnel measurable. Additive only: three empty columns on public.scans, two format checks, comments. No existing value changes.
-- The columns live on the scan row on purpose: they follow whatever retention and access-request rules already apply to that row.
--   hubspot_contact_id  set by the scan-report Worker when the report goes out (from the contact lookup it already makes).
--   stripe_customer_id  set by /api/stripe-webhook on checkout.session.completed (dormant until checkout opens).
--   report_viewed_at    first time the report page was opened from the email button, after the report was sent.
-- Access is unchanged: public.scans already has RLS with no anon or authenticated policy (service_role only). Idempotent.
alter table public.scans
  add column if not exists hubspot_contact_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists report_viewed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scans_hubspot_contact_id_format' and conrelid = 'public.scans'::regclass) then
    alter table public.scans add constraint scans_hubspot_contact_id_format check (hubspot_contact_id is null or hubspot_contact_id ~ '^[0-9]{1,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scans_stripe_customer_id_format' and conrelid = 'public.scans'::regclass) then
    alter table public.scans add constraint scans_stripe_customer_id_format check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,64}$');
  end if;
end $$;

comment on column public.scans.hubspot_contact_id is 'CK-11491. HubSpot contact id for this scan''s address, kept when the report is sent. Null = no contact found or report not sent.';
comment on column public.scans.stripe_customer_id is 'CK-11491. Stripe customer id, set when a checkout with this scan''s address completes. Null = no completed checkout.';
comment on column public.scans.report_viewed_at is 'CK-11491. First view of the report page from the email button after the report was sent. Daily totals are also counted in learning_aggregate_daily (funnel_step, report_viewed).';
