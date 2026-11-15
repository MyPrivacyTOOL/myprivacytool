# Family add-on: design note (MPC-9820)

Status: DESIGN ONLY. Nothing here is built or live. `family.seat_report` stays `planned` in `capability_min_tier`, the family section of `/pricing` keeps its Planned marker, and no flag in `src/config/featureStatus.ts` changes. The task's Input Spec requires the permission model to be approved by Chris before code; section 7 lists the four decisions he has to make. The build starts on the same Notion row the day they are recorded.

## 1. The claim this has to make true

`/pricing` (ledger C17): "Add up to 4 family members for $5/month each ... You can see the reports of children on your plan."

LIVE test (Build Spine, F3): an owner invites a member; the member's scan counts against the allowance; a guardian sees only a minor's report.

## 2. What already exists (read from `main`, 2026-11-08)

| Piece | Where | State |
| --- | --- | --- |
| `households`, `household_members` (roles owner / adult / child; invited / active / removed; 5-profile cap; RLS) | `20261013010000_mpc_7650_family_plan_households.sql` | Applied in the repo. Keyed by `auth.users.id`, which is also `accounts.id`, so it joins to accounts with no mapping table. |
| `mpt_household_can_view_reports(viewer, subject)` | same migration | True for yourself, or for the household owner reading an active child. Adults, the owner included, cannot read each other. Not yet called from any read path. |
| Accounts, account-to-scan links | MPC-9817 | Built. |
| Entitlements, scan allowances, `mpt_consume_scan`, `mpt_set_plan` | MPC-9818 | Built (PR 775). Allowance is keyed by a hash of the confirmed email, not by account. |
| `family.seat_report` capability row | MPC-9818 seed | `min_tier = basic`, status `planned`, note `proposal`. |
| Stripe | MPC-9819 / 7833 | Not live. No Stripe key in Cloudflare; registry entry `stripe` is `enabled:false`; the "Family member" $5/month product exists inactive only. |

So the permission rule and the tables are done. What is missing is everything that connects them: invites, seat billing, per-seat scan accounting, the guardian read path, guardian authority on record, and the tests.

## 3. Permission model (binding rules, from vision 6A.4 as quoted in the Input Spec and MPC-7650)

1. Payment by one person never grants access to another person's reports. The payer is not special; only the guardian relationship is.
2. An adult member's reports are private from the owner and from every other adult. There is no adult-to-adult "shadow" view and no surveillance model.
3. Only the household owner can be a guardian, only for a member with role `child`, and only while the guardian authority on record is valid.
4. The guardian rule is enforced where reports are read (`mpt_get_account_scan`, `mpt_list_account_scans`), by calling `mpt_household_can_view_reports`. Hiding a link in the UI is not enforcement.
5. A child is never watched silently: the child sees, in the product, that the owner can see their reports, and sees a log of when.
6. Cancellation is not deletion, and removal is not deletion. Removing a member ends the owner's access at once; the member's own scans stay with the member.

## 4. Data model (additive, one migration, small statements)

On `household_members`:

- `guardian_attested_at timestamptz`, `guardian_attested_by uuid` (the owner): when the owner stated they are the parent or legal guardian. Required to create or keep a `child` row.
- `guardian_until date`: the date the guardian view ends (the child's 18th birthday, or earlier). A date, not a birth date, so the product stores no age data it does not need. A daily job turns an expired child into an `adult` and closes the view.
- `seat_state text`: `pending_payment`, `active`, `suspended` (owner's plan lapsed), `removed`. Only `active` seats count and can be read.

New:

- `guardian_view_log (id, household_id, guardian_user_id, child_user_id, web_scan_id, viewed_at)`. Names and scan numbers only, no report content, no IP. Readable by the child and the owner, deleted with the household.
- `mpt_household_seat_count(household)`: active non-owner seats; billing quantity.
- `mpt_invite_member`, `mpt_accept_invite`, `mpt_remove_member`, `mpt_list_household`, `mpt_guardian_list_scans(guardian, child)`, `mpt_guardian_get_scan(guardian, child, scan)` (all `service_role` only, like MPC-9817/9818 functions). The last two call `mpt_household_can_view_reports`, write `guardian_view_log`, and return nothing for an adult.

Invites go by the registered email path (Resend, already in the registry). No new outbound host. Stripe is already registered, `enabled:false`; it turns on only through the MPC-7833 go-live checklist, not here.

## 5. Billing

One Stripe subscription item per household: price "Family member" ($5/month, USD, monthly only), `quantity` = active non-owner seats. Adding or removing a seat updates the quantity with proration; the webhook from MPC-9819 stays the only writer of plan state. Until MPC-9819 is live, seats can be created only by a manual grant (`seat_state = active` with a logged reason), so the whole flow can be tested on synthetic accounts without taking money. When the owner's plan lapses, seats go `suspended`, the owner's guardian view closes, and nothing is deleted.

## 6. Scan accounting

A member's scan is consumed through the existing `mpt_consume_scan`. Which allowance it consumes from is decision 2 below. Either way the rule is idempotent on scan number and a member typing someone else's address cannot burn that person's month (the MPC-9818 24-hour grace for unconfirmed scans applies unchanged).

## 7. Decisions for Chris (A or B; recommendation first)

1. **Which tiers can add family members.** A: Basic and above (what the Tier & Service Matrix proposes and the `family.seat_report` row already says; fits the report-first choice of 2026-11-07). B: Pro and Executive only (what `/pricing` and the MPC-7650 note say today; no matrix change). **Recommend A.** Either way `/pricing` copy changes in the build PR so the page matches the data.
2. **Whose allowance a member's scan uses.** A: one pooled household allowance equal to the owner's tier (literal reading of "family allowance"; a $5 seat then adds a profile and separate history but no extra scans, e.g. 5 shared scans on Basic). B: each seat gets the owner's tier allowance on its own (5 per Basic seat, 25 per Pro seat), so $5 buys a real seat. **Recommend B**, with the cost caveat that licensed broker lookups (MPC-9846, not yet quoted) are charged per check; at most 4 extra seats bounds it.
3. **How guardian authority is recorded.** A: the owner attests when adding a child ("I am this child's parent or legal guardian"), the product stores the attestation time and a `guardian_until` date, the child (if they have a sign-in) is told in-product, and the view ends automatically. B: also require the child's own account to confirm before the owner can see anything. **Recommend A**: B makes a young child's protection depend on the child's ability to click.
4. **Launch order for child access.** A: ship invites, seats, per-seat scans and adult privacy first; keep the guardian view behind a flag until the lawyer review (MPC-6798: HK PDPO, GDPR Art. 8 age limits, and whether attestation is enough) clears it. B: ship everything together. **Recommend A.** The F3 LIVE test needs the guardian part, so F3's family line flips only after the flag is on.

## 8. Test plan (the build PR must carry all of these)

- Real Postgres: the guardian read returns a child's scan to the owner; returns nothing for an adult member, for another household's owner, for a non-owner adult, for a `removed` or `suspended` child, and after `guardian_until`; every guardian read writes one log row; the 5-profile cap holds; an owner cannot create a `child` row without an attestation.
- Worker tests: invite, accept, remove; seat count equals billed quantity; a member's scan consumes the allowance chosen in decision 2 and is idempotent on scan number.
- Synthetic live run (like `accounts-live-check`): owner invites a member on a synthetic address, the member scans and is counted, a guardian sees a synthetic minor's report and cannot see a synthetic adult's.
- Only after that run is green and decision 4 allows it: flip `family.seat_report` to `live` and remove the Planned marker on `/pricing`.

## 9. Rollback

All new objects are additive. Switches: `FAMILY_ENABLED` (invites and seats) and `GUARDIAN_VIEW_ENABLED` (child report access), both off by default. SQL rollback will sit at the top of the migration, as in MPC-9817 and MPC-9818.
