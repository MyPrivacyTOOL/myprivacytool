-- MPC-7502: pricing source of truth. One row per plan; the website build, checkout and the Stripe price check read this table.
-- Prices are public, so anon/authenticated may read ACTIVE rows only; only service_role writes. Stripe price ids are not secret
-- but are not needed by browsers, so they are exposed only through column grants to service_role.
-- Seeded with the tiers approved 2026-10-14 (Free $0, Basic $7.99, Pro $14.99, Executive $49.99). Scan allowances are the placeholder
-- values from src/pages/Pricing.tsx and are still pending review.
-- Rollback: drop table public.plans;
create table if not exists public.plans (
  slug                text primary key check (slug ~ '^[a-z][a-z0-9_]{0,31}$'),
  name                text not null check (char_length(name) between 1 and 40),
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  currency            text not null default 'usd' check (currency = 'usd'),
  scans_label         text not null check (char_length(scans_label) <= 80),
  note                text check (char_length(note) <= 120),
  sort_order          integer not null unique,
  active              boolean not null default true,
  stripe_price_id     text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- the free plan never has a Stripe price; paid plans may get one when checkout goes live
  check (monthly_price_cents > 0 or stripe_price_id is null)
);

comment on table public.plans is 'MPC-7502. Pricing source of truth. Public read of active rows (no stripe_price_id); writes service_role only.';

alter table public.plans enable row level security;
alter table public.plans force row level security;

revoke all on public.plans from anon, authenticated;
grant select (slug, name, monthly_price_cents, currency, scans_label, note, sort_order, active) on public.plans to anon, authenticated;
grant all on public.plans to service_role;

create policy "public reads active plans" on public.plans
  for select to anon, authenticated using (active);
create policy "service role full access" on public.plans
  for all to service_role using (true) with check (true);

insert into public.plans (slug, name, monthly_price_cents, scans_label, note, sort_order) values
  ('free',      'Free',      0,    '1 scan per month',  'No credit card required', 1),
  ('basic',     'Basic',     799,  '5 scans per month',  null,                      2),
  ('pro',       'Pro',       1499, '25 scans per month', null,                      3),
  ('executive', 'Executive', 4999, 'Unlimited scans',    null,                      4)
on conflict (slug) do nothing;
