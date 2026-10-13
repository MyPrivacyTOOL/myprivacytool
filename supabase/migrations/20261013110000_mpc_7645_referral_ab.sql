-- MPC-7645: A/B testing across the referral funnel. Two nullable columns that record which variant a person was given, so results come from
-- this database (GA4 only sees visitors who accept cookies). Null = no test was running. Additive; same access model as 20261013100000.
-- Rollback: alter table public.users drop column referral_block_variant; alter table public.referrals drop column invite_variant;
alter table public.users
  add column if not exists referral_block_variant text check (referral_block_variant in ('control', 'friend_first'));
alter table public.referrals
  add column if not exists invite_variant text check (invite_variant in ('control', 'specific_subject'));

comment on column public.users.referral_block_variant is 'MPC-7645 A/B: wording of the invite block in this user''s report email. Null = no test running.';
comment on column public.referrals.invite_variant is 'MPC-7645 A/B: subject line of the invitation email sent to this friend. Null = no test running.';
