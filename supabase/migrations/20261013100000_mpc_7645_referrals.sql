-- MPC-7645: referral programme ("Invite 3 friends"). A user gets a public referral code; friends invited by email or by the
-- shared link are tracked here; when a friend's first report has been delivered the referrer earns one month of Pro.
-- Additive only. Same access model as MPC-6677: RLS enabled and FORCED with no policies, so only the scan-report Worker
-- (service_role) can read or write. No readable invitee address is stored: an invited address is kept only as a SHA-256 hash
-- (same hash as email_suppressions), used to match the friend if they later sign up and to stop the same friend being invited twice.
-- Rollback (nothing else depends on it):
--   drop function public.mpt_complete_referral(uuid); drop table public.referrals;
--   alter table public.users drop column referral_code, drop column pro_months_earned;

alter table public.users
  add column if not exists referral_code     text unique check (referral_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  add column if not exists pro_months_earned integer not null default 0 check (pro_months_earned between 0 and 12);   -- ledger only: billing applies it when Pro opens

create table if not exists public.referrals (
  id                    uuid primary key default gen_random_uuid(),
  referrer_user_id      uuid not null references public.users(id) on delete cascade,
  referee_user_id       uuid unique references public.users(id) on delete cascade,   -- null while the friend has only been invited; unique = a person is referred once
  invitee_hash          text check (invitee_hash ~ '^[0-9a-f]{64}$'),                 -- SHA-256 of the lower-cased invited address (no readable address kept)
  source                text not null default 'link' check (source in ('link','invite_email')),
  status                text not null default 'invited' check (status in ('invited','signed_up','completed')),
  invite_email_sent_at  timestamptz,
  signed_up_at          timestamptz,
  completed_at          timestamptz,
  rewarded_at           timestamptz,                                                  -- set when the referrer's month was credited (not when the 12-month cap was already reached)
  created_at            timestamptz not null default now(),
  check (referee_user_id is distinct from referrer_user_id),
  check (status = 'invited' or referee_user_id is not null)
);
create unique index if not exists referrals_referrer_invitee_key on public.referrals (referrer_user_id, invitee_hash) where invitee_hash is not null;
create index if not exists referrals_referrer_status_idx on public.referrals (referrer_user_id, status);

alter table public.referrals enable row level security;
alter table public.referrals force row level security;
revoke all on public.referrals from anon, authenticated;
grant select, insert, update, delete on public.referrals to service_role;

-- Marks a friend's referral completed and credits the referrer one month of Pro, atomically and at most once per friend.
-- Called by the Worker only after the friend's report has been delivered. Returns no row when there is nothing to complete
-- (not referred, not signed up, or already completed). Max 12 months per referrer; past that the referral still counts as completed.
create or replace function public.mpt_complete_referral(p_referee_user_id uuid)
returns table (referrer_user_id uuid, rewarded boolean, pro_months_earned integer)
language plpgsql
security definer
set search_path = public
as $$
declare r public.referrals; months integer;
begin
  update public.referrals set status = 'completed', completed_at = now()
   where referee_user_id = p_referee_user_id and status = 'signed_up'
   returning * into r;
  if r.id is null then return; end if;
  update public.users u set pro_months_earned = u.pro_months_earned + 1, updated_at = now()
   where u.id = r.referrer_user_id and u.pro_months_earned < 12
   returning u.pro_months_earned into months;
  if months is not null then
    update public.referrals set rewarded_at = now() where id = r.id;
    return query select r.referrer_user_id, true, months;
  end if;
  return query select r.referrer_user_id, false, (select u.pro_months_earned from public.users u where u.id = r.referrer_user_id);
end $$;

revoke all on function public.mpt_complete_referral(uuid) from public, anon, authenticated;
grant execute on function public.mpt_complete_referral(uuid) to service_role;

comment on table public.referrals is 'MPC-7645. One row per referred or invited friend. No readable invitee address: invitee_hash only.';
comment on column public.users.referral_code is 'MPC-7645. Public code in the share link /invite?ref=CODE. Not a secret: sending invites needs the signed manage token as well.';
comment on column public.users.pro_months_earned is 'MPC-7645. Free Pro months earned from completed referrals (max 12). A ledger: billing applies it when Pro opens.';
