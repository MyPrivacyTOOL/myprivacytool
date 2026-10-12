# Referral programme ("Invite 3 friends"), MPC-7645

Status: **built, switched OFF.** Nothing changes for anyone until the go-live steps below are done. All copy is DRAFT and needs Chris's approval (and the Privacy wording a lawyer's).

## What it does
- Every user gets a public **referral code** (8 characters, no 0/O/1/I) the first time a report is built for them, and a **private link** (code + signed token) in their report email.
- **Share link** `https://myprivacytool.io/invite?ref=CODE` (anyone can use it). It lands on `/invite`, which passes the code to `/scan?ref=CODE`.
- **Invite 3 at a time** from the private link (`/invite#c=CODE&t=TOKEN`): the Worker emails each friend one plain email, up to **10 invitations per person** in total.
- A friend counts when they are a **brand-new user** (no earlier users row) who arrived with the code and whose **first report has been delivered** (`scans.report_status='sent'`). That credits the referrer **one month of Pro** (cap 12) and emails them once.
- Progress (signed up, got their report, months earned, invitations left) is on the private `/invite` page. There is no account dashboard in the product yet; this page is the dashboard surface.

## Reward = a ledger
Pro is not on sale (`src/pages/Pricing.tsx`: "Get launch updates"), so the reward is `users.pro_months_earned` (0 to 12). Copy says "your months are saved on your account and start when Pro opens". **Billing must read this column when Pro launches.** The task text gives two readings, "a free month per friend" (Description) and "Pro upgrade when 3 friends complete" (Input Spec); this builds the first, and the "3" is the number of invitations per batch. If Chris wants the all-or-nothing reading, change `mpt_complete_referral` only.

## Where it lives
| Piece | File |
|---|---|
| Tables, columns, atomic reward function | `supabase/migrations/20261013100000_mpc_7645_referrals.sql` |
| Codes, tokens, attach, complete, invite and status endpoints | `workers/scan-report/lib/referral.js` |
| Invite, reward emails; report block (draft copy) | `workers/scan-report/lib/referralEmail.js` |
| Wiring (`/api/referral/*`, `ref` on `/api/scan`, report block, reward on report sent) | `workers/scan-report/index.js` |
| Site page, helpers | `src/pages/Invite.tsx`, `src/lib/referral.ts` |
| Policy text (shown only while on) | `src/pages/Privacy.tsx` section 16 |
| Tests | `workers/scan-report/referral.test.mjs`, referral block in `worker.test.mjs`, `supabase/tests/schema.test.sql`, `src/lib/referral.test.ts`, `src/pages/Invite.test.tsx`, `src/pages/Privacy.test.tsx` |

## API (all POST, JSON, 404 while off)
- `/api/scan` accepts an optional `ref`. Ignored unless the switch is on; only links **new** users; self-referral (same mailbox, gmail dots and `+tags` collapsed) refused; one referrer per person.
- `/api/referral/status {code, token}` returns counts only. No addresses, no hashes.
- `/api/referral/invite {code, token, emails[1..3]}` returns `{ok, sent, skipped}`. `skipped` never says why (already a member, opted out, suppressed, already invited, own address), so it cannot be used to look people up.

## Privacy and abuse rules built in
- The code is public; **sending needs the signed token** (HMAC of the code with `UNSUBSCRIBE_SECRET`). It is in the URL fragment, so it is not sent to our server, not UTM-tagged, and the page removes it from the address bar.
- Invited addresses are stored only as SHA-256 (same hash as `email_suppressions`). The email goes out in the same request; nothing readable is kept, and the table has no email column (asserted in `schema.test.sql`).
- Before sending: members, opted-out users and `email_suppressions` are skipped; the recipient allowlist (test mode) is honoured; the email carries a one-click unsubscribe (which writes the suppression). One email per friend, idempotency key per (referrer, friend), **no reminders**.
- A failed send deletes its row so it does not use up an invitation.
- Reward is atomic and at most once per friend (`mpt_complete_referral`), only after the friend's report is delivered, capped at 12 months. A referrer who unsubscribed still earns the month but gets no email.
- DSAR: erasing a user cascades their referral rows; `mpt_dsar_erase` also removes invitations addressed to the erased address (by hash) and `mpt_dsar_export` lists the person's referral rows without other people's hashes. **Apply the migration before re-running `supabase/sql/mpt-dsar-erase-export.sql`.**
- Not done (call for Chris): device/IP-based fraud checks. Self-referral is blocked by mailbox, not by person; a determined person can make a second mailbox. The 12-month cap and "report delivered" rule bound the cost.

## Success criteria from the task
"Feature live, tracking works, 10%+ of users send referrals." Tracking works (tables above). To measure the 10%: `select count(distinct referrer_user_id) filter (where source = 'invite_email') * 1.0 / (select count(*) from users where referral_code is not null) from referrals;` (people who invited at least one friend by email, of everyone who was shown a code). Link shares are not countable (a copied link leaves no trace until it is used).

## Go live
1. Chris approves the copy in `lib/referralEmail.js`, `src/pages/Invite.tsx` and Privacy section 16 (and a lawyer reads the third-party invitation email: it is mail to someone who has not consented, sent at the user's request).
2. Apply `20261013100000_mpc_7645_referrals.sql` to production (Supabase), then re-run `supabase/sql/mpt-dsar-erase-export.sql`.
3. `UNSUBSCRIBE_SECRET` is already required by the follow-up emails; confirm it is set on `mpt-scan-report`.
4. Set `REFERRALS_ENABLED = "true"` in `workers/scan-report/wrangler.toml` and deploy; set `VITE_REFERRALS_ENABLED=true` on the Cloudflare Pages project and redeploy. Both are needed (the site hides the page and the policy text without its flag).
5. Test with `RECIPIENT_ALLOWLIST` set first: run a scan, open the private link from the report, invite a test inbox, run a scan from that inbox through the invite, and check the reward email.
6. Rollback: set `REFERRALS_ENABLED = "false"` and redeploy. Existing rows and earned months stay; nothing is sent.

## Test
`node workers/scan-report/referral.test.mjs`, `node workers/scan-report/worker.test.mjs`, `npm run test:db`, `npx vitest run src/lib/referral.test.ts src/pages/Invite.test.tsx src/pages/Privacy.test.tsx`.
