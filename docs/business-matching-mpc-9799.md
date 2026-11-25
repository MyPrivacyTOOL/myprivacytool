# MPC-9799 (EXT-12): business teams, who authorises, what the employer sees, what a "match" means

Checked 2026-11-18 against main HEAD 65f65c7. Decisions (Chris, 2026-11-18): Q3 the employer sees aggregate totals by default and an individual's results only with that employee's explicit, recorded consent; Q4 authorisation is admin invite, then each employee consents before their own scan runs; a buyer-uploaded email list is not consent.

## Authorisation (code: workers/scan-report/lib/business.js, supabase/migrations/20261108160000_mpc_9824_business_teams.sql)

1. A Business admin creates a team (`POST /api/business/team`); this writes one `admin_invite` row in the 48-hour queue (`public.mpt_business_requests`).
2. The admin invites employees by work email. Each gets a token link (`/business/join`).
3. The employee presses the authorise button (`POST /api/business/join/authorise`, `consent: true`, consent version `2026-11-08-v1`); the check runs then. Without `consent: true` the Worker answers 400. This writes one `employee_consent` row in the same queue.
4. The employee can decline, withdraw (revoke deletes their results) or choose to share detail with the admin (`POST /api/business/join/{decline,revoke,share}`).

A person who is invited but has not authorised has no data row and contributes to no results total.

## What the employer sees (`public.mpt_business_summary`)

- Always: counts (invited, awaiting, authorised, declined, revoked) and an aggregate over authorised members only: people included, people with a listing, pages checked, listed, not listed, not checked.
- Per person: email address and status. Result detail only where that person ticked "share my detail with my admin".

## What the employee sees

Their own results at once, each with a link to the page checked (`evidence_url`).

## What "match" means (workers/scan-report/lib/listingCheck.js)

The check looks only at pages the employee pastes and compares them with the email address and the name, place and phone the employee types for that check; the typed values are used once and not stored. A page gets a state and a match level:

| State | Match | Meaning |
|---|---|---|
| listed | exact | the email is on the page, or name and place, or name and phone |
| listed | probable | name and part of the place |
| listed | possible | name or phone alone; the code marks `is_guess: true` |
| not_listed | none | page gone (404/410) or the details are absent |
| not_checked | none | fetch blocked, timeout, no identifiers, not a listing page; never reported as not_listed |

## Known issues (found 2026-11-18, not fixed here: they need a migration, which only the manual deploy-supabase workflow may apply)

1. **Guesses are counted as listings.** `mpt_business_summary` counts every result with `state = 'listed'`, including `possible` matches, in both `listed` and `people_with_a_listing`. The employer's total therefore includes pages the checker itself calls a guess (MATCH-002).
2. **Small groups.** With one or two authorised employees the aggregate is effectively an individual's result, which defeats "aggregate by default" (PRIVACY-033/034). No minimum group size is applied.
3. **No false-match path for the employee.** An employee sees the result and the evidence link and can withdraw (which deletes the results), but cannot mark one result "not me" before it is counted.

## The synthetic row BIZ-CRQAPLXE (decision Q5: delete it from production, record evidence)

Checked 2026-11-18 on production project xmdmkumwxpgahmlweuug: `mpt_business_requests` has 0 rows (no row with ref BIZ-CRQAPLXE), `mpt_business_teams` 0 rows, `mpt_business_members` 0 rows. There was nothing to delete and no delete was run. When or by whom it was removed is not recorded. The ref may also exist in a Slack message (the Worker posts the ref and team size to Slack); that was not touched.
