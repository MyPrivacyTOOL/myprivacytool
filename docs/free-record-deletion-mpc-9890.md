# Free-record deletion (MPC-9890)

Open Tracker design sections 4.1, 4.2, 8.4. Decisions: Chris Ransford, 2026-11-08 13:19 HKT (N = 7 days).

## What happens

| Moment | What | Where |
| --- | --- | --- |
| Report email sent | `scans.delete_after = report_sent_at + N` | trigger `scans_set_delete_after` |
| Resend `email.delivered` receipt | `delete_after = delivered time + N` (a later receipt only ever moves it later) | same trigger, fed by `mpt_record_email_receipt` |
| T-24 h | countdown email: exact deletion time, one-click **Keep**, **Sign up** | `lib/freeRecord.js`, `mpt_claim_deletion_notices` |
| T-4 h | second countdown email | same |
| T-0 | `mpt_purge_free_records()` deletes the record; then the Worker deletes the HubSpot contact and sends "done, deleted" from the address list the purge returned (never stored) | Worker tick every 5 minutes |
| Backstop | hourly pg_cron, only records more than 1 hour overdue (no T-0 mail) | migration 20261108210000 |

N is the value the person consented to (`scan_consents.n_hours`, from `CONSENT_CONFIG.n_hours`); `public.free_record_policy.n_hours` (168) is the fallback and must equal it.
Existing records got a fresh window of N hours from the migration, so they receive the countdown emails first.

## What is deleted

`scan_consents`, `web_scans` (+ `web_scan_contacts`, listing checks, events by cascade), `scans` (+ `signals`, `hexagon_scores`), `leads`, `users` (never signed up and no scan left),
`scan_recipient_log`, the ledger record of the person, and the HubSpot contact. Triggers on `web_scans` and `scans` remove the consent and the who-saw-what rows on every other deletion path too.
The aggregate hook `mpt_aggregate_before_delete` (MPC-9892 replaces its body) runs in the same transaction before the delete. After deletion only a count per `consent_version` remains (`scan_consent_counts`).

## Who is excluded

Kept (`scans.kept_at`, the Keep link), signed up (`accounts`, `account_scans`) and paid (an account with a plan). Sign-up is the explicit keep action. `public.mpt_scan_is_kept` is the single definition.

## Stopped storing

- `users.ip_address` and `leads.ip_address` are no longer written (`handleScan`). Existing values are nulled by MPC-9891.
- The Notion lead log no longer receives `IP Address` (`workers/mpt-leads/worker.js`).
- No HubSpot contact is created for a user who has not signed up (`syncHubSpot` removed from `handleScan`).

## Consequences (stated, not hidden)

- No follow-up or day-10 emails to a free user once the record is gone: the address is gone.
- No "welcome back / recognise this device" for free users (MPC-7494 only works against retained scans); it works for signed-up and paid users.
- A person who does nothing is deleted at the stated time and cannot be recognised afterwards.

## Provider deletion limits (design 8.4)

| Provider | Can we delete? | Limit |
| --- | --- | --- |
| Supabase | Yes, rows removed | Database backups hold deleted rows until the backup retention window ends. |
| HubSpot | Yes, `contacts/gdpr-delete` is a permanent delete by email | Needs the token's contacts write scope; a 404 means there was no contact. |
| Notion | Archive only, no hard delete | Scan leads no longer write email or IP; `mpt-leads` form submissions still write the email the person typed (open question for Chris). |
| Resend | No | Send logs are provider-side; stated in the registry as provider-side retention. |
| Cloudflare (Workers, Pages) | No | Edge logs are provider-side; not joined to the scan. |

Any provider that cannot delete goes in the lawyer packet (MPC-6798 / MPC-9895).

## Switches and rollback

`FREE_RECORD_DELETION_ENABLED` in `workers/scan-report/wrangler.toml` ("true" = countdown emails, Keep link, 5-minute purge). Anything else turns the Worker side off; the hourly backstop still deletes records more than an hour overdue.
Deleted rows cannot be restored: run `select public.mpt_purge_free_records(true)` for a dry run first. SQL rollback is at the bottom of the migration.
