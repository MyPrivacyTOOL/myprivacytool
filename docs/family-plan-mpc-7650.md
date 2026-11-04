# Family Plan (MPC-7650)

Pro and Executive subscribers add family members on one subscription: up to 5 profiles in total (the owner plus 4), **+$5/month per additional member**. Each profile has its own scan history, reports and monitoring.

## Permissions
| Viewer | Can read |
|---|---|
| Any member | their own reports |
| Owner (primary account holder) | their own, and any **child** member's |
| Adult (owner included) | not another adult's |

The rule is `public.mpt_household_can_view_reports(viewer, subject)`. RLS: the owner manages every row in their household; any other member reads only their own row.

## What is built
- Migration `20261013010000_mpc_7650_family_plan_households.sql`: `households`, `household_members` (roles owner/adult/child, status invited/active/removed), the 5-profile cap (trigger), the permission function, RLS. Tests are in `supabase/tests/schema.test.sql`.
- `/pricing` shows the add-on and the privacy rule (planned, like the other prices).

## Not built (blocked, needs a decision)
There are no user accounts, sign-in or checkout yet (paid plans are "not open yet" on `/pricing`), and scans are not tied to a user. So these are still to do once accounts and billing exist:
1. Invite by email (send the invite, accept it, set `user_id`/`status = active`/`joined_at`).
2. Billing: +$5/month per active member beyond the owner, proration on add/remove.
3. Tie each profile's scans, reports and monitoring to its `user_id`, then enforce `mpt_household_can_view_reports` where reports are read.
4. Child profiles: consent and age rules for monitoring a minor (legal review, HK PDPO and GDPR-K) before launch.
5. Success metric (20%+ of Pro users add a member): add events once the invite flow exists.
