-- MPC-7647: HK Spam Shield paid feature. One row per MPT account + store subscription.
-- The app and the store webhook (RevenueCat or Play/App Store notifications) write through the entitlement API
-- using service_role. Clients never read or write this table directly. No phone number or call content is stored.
-- Rollback: drop table public.hk_shield_entitlements;
create table if not exists public.hk_shield_entitlements (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  account_id      uuid not null,                                   -- MPT account (auth.users.id once accounts ship)
  plan            text not null check (plan in ('hk_shield_monthly', 'hk_shield_yearly')),
  store           text not null check (store in ('google_play', 'app_store', 'web')),
  store_ref       text not null check (char_length(store_ref) <= 200), -- purchase token / original transaction id
  status          text not null check (status in ('active', 'grace', 'cancelled', 'expired', 'refunded')),
  current_period_end timestamptz not null,
  cancelled_at    timestamptz,
  unique (store, store_ref)
);

comment on table public.hk_shield_entitlements is 'MPC-7647. Paid HK Spam Shield entitlements. service_role only.';

create index if not exists hk_shield_entitlements_account_idx on public.hk_shield_entitlements (account_id);

alter table public.hk_shield_entitlements enable row level security;
alter table public.hk_shield_entitlements force row level security;

revoke all on public.hk_shield_entitlements from anon, authenticated;
grant all on public.hk_shield_entitlements to service_role;

create policy "service role full access" on public.hk_shield_entitlements
  for all to service_role using (true) with check (true);
