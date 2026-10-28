// MPC-7555: THE map of every email MyPrivacyTOOL can send, as data the tests read. The human version (with the live-account findings) is the Notion page
// "MPT > Email > Map of every email and the one unsubscribe (SOURCE OF TRUTH, MPC-7555)", linked from the strategy page. Change this file and that page together.
// Plain ESM, no dependencies. shared/email-map.test.mjs fails the build if:
//   - a file that calls the email provider is not listed here (a new sender cannot be added unnoticed),
//   - a scan-report email's idempotency-key prefix is not listed here,
//   - a non-transactional sender does not check THE opt-out before sending,
//   - email code says "reply ... unsubscribe", or an unsubscribe path does not write THE opt-out.
//
// CLASSES. transactional = sent because of something the recipient just did, and needed to complete it: the confirmation of a request they made, the report they
// requested, the unsubscribe confirmation, a reply to their own message, a one-time proof link. Transactional emails still send after an opt-out (but see
// `afterOptOut`). non_transactional = everything else (follow-ups, referral invitations and rewards, the Hong Kong day-10 reminder, any newsletter or HubSpot marketing
// email). These STOP for an address that has opted out. internal = to us, never to a visitor.
//
// THE opt-out = one row in public.email_suppressions per address (SHA-256 of the lower-cased address), written by optOutEverywhere() (workers/scan-report/lib/suppression.js),
// a database trigger on users.email_opt_out_at, and the daily HubSpot sync. Senders check it with isOptedOut / suppressedAmong.

export const CLASSES = ['transactional', 'non_transactional', 'internal'];

export const SENDERS = [
  // ---- scan-report Worker (Resend, hello@myprivacytool.io), every send goes through lib/email.js sendEmail()
  { id: 'scan-confirmation', class: 'transactional', provider: 'resend', file: 'workers/scan-report/index.js', idempotencyPrefix: 'confirm-', trigger: 'POST /api/scan accepted (the visitor asked for a report)', template: 'buildConfirmationEmail (lib/email.js)', audience: 'scans.email_scanned (the requester)', afterOptOut: 'still sends: it confirms a request made after the opt-out', status: 'live' },
  { id: 'scan-report', class: 'transactional', provider: 'resend', file: 'workers/scan-report/index.js', idempotencyPrefix: 'report-', trigger: 'every-5-minute cron, scan pending', template: 'buildReportEmail (lib/email.js) + JSON attachment', audience: 'scans.email_scanned (the requester)', afterOptOut: 'cancelled if the person opted out AFTER requesting it (report_last_error "cancelled: unsubscribed before the report was sent"); a request made after an opt-out still gets its report', status: 'live' },
  { id: 'followup-day3-day7', class: 'non_transactional', provider: 'resend', file: 'workers/scan-report/index.js', idempotencyPrefix: 'followup-', trigger: 'cron, 3 and 7 days after the report. With FOLLOWUP_STATE_ENABLED=true (MPC-7554): every user, chosen by what was found (findings / nothing found), ends on "I have fixed this" or an opt-out. Off (today): first-100 cohort only, calendar-driven', template: 'buildFollowUpEmailV2 (lib/followup.js); off: buildFollowUpEmail (lib/onboarding.js)', audience: 'sent reports (state on: all users; off: first-100 cohort)', optOutCheck: 'suppressedAmong', status: 'live in the earlier form (needs UNSUBSCRIBE_SECRET); state-driven form built, OFF until the copy is approved and the migration applied' },
  { id: 'unsubscribe-request', class: 'transactional', provider: 'resend', file: 'workers/scan-report/index.js', idempotencyPrefix: 'unsubreq-', trigger: 'POST /api/unsubscribe-request (the /unsubscribe page, address typed)', template: 'buildUnsubscribeRequestEmail', audience: 'the address typed, only if on a list', afterOptOut: 'not sent to an address already opted out', status: 'live' },
  { id: 'unsubscribed-confirmation', class: 'transactional', provider: 'resend', file: 'workers/scan-report/index.js', idempotencyPrefix: 'unsubscribed-', trigger: 'first confirmed unsubscribe for an address', template: 'buildUnsubscribedEmail', audience: 'the address that just opted out', afterOptOut: 'sent once, by design', status: 'live' },
  { id: 'referral-invite', class: 'non_transactional', provider: 'resend', file: 'workers/scan-report/lib/referral.js', idempotencyPrefix: 'referral-invite-', trigger: 'POST /api/referral/invite (a user invites a friend)', template: 'lib/referralEmail.js', audience: 'the friend typed by the referrer', optOutCheck: 'suppressedAmong', status: 'live in tester mode' },
  { id: 'referral-reward', class: 'non_transactional', provider: 'resend', file: 'workers/scan-report/lib/referral.js', idempotencyPrefix: 'referral-reward-', trigger: "a referred friend's report is delivered", template: 'buildRewardEmail (lib/referralEmail.js)', audience: 'the referrer (users.email)', optOutCheck: 'suppressedAmong', status: 'live in tester mode' },
  { id: 'hk-spam-day10', class: 'non_transactional', provider: 'resend', file: 'workers/scan-report/lib/hkSpam.js', idempotencyPrefix: 'hk-spam-day', trigger: 'cron, 09:00 HKT, 10 days after a /HongKongSpam registration', template: 'buildHkSpamEmail (lib/hkSpam.js, bilingual)', audience: 'hk_spam_registrations with reminder consent', optOutCheck: 'suppressedAmong', status: 'live (HK_SPAM_EMAILS_LIVE=true since 2026-10-26)' },
  { id: 'hk-spam-test', class: 'internal', provider: 'resend', file: 'workers/scan-report/lib/hkSpam.js', idempotencyPrefix: 'hk-spam-test-', trigger: 'HK job in test mode', template: 'same as day-10, sample', audience: 'HK_SPAM_TEST_INBOXES only', status: 'test mode only' },
  // ---- other Workers
  { id: 'lead-capture-confirmation', class: 'transactional', provider: 'resend', file: 'workers/mpt-leads/worker.js', trigger: 'lead form on /start (not the /scan page)', template: 'buildConfirmationEmail (worker.js)', audience: 'the submitter', afterOptOut: 'confirms a request just made', status: 'OFF in production: CONFIRMATION_OWNER = "scan-report" (wrangler.toml); the opt-out wording in it was fixed to a real link' },
  { id: 'high-priority-lead-alert', class: 'internal', provider: 'resend', file: 'workers/mpt-leads/worker.js', trigger: 'lead score above 80', template: 'plain text', audience: 'ALERT_EMAIL (us)', status: 'live only if ALERT_EMAIL is set' },
  { id: 'support-reply', class: 'transactional', provider: 'resend', file: 'shared/support/email-notifier.ts', trigger: 'an inbound support email is answered', template: 'ResendNotifier', audience: 'the address that wrote to us, only', afterOptOut: 'a reply to their own message', status: 'built (MPC-8528), see Notion for go-live' },
  { id: 'support-proof-link', class: 'transactional', provider: 'resend', file: 'shared/support/proof-request.ts', trigger: 'the person asks to prove ownership of an account', template: 'ResendProofMailer', audience: 'the account address they typed', afterOptOut: 'one-time proof they asked for', status: 'built (MPC-8528)' },
];

// Senders that do not use our code (nothing in the repo calls their API). Listed so the map is complete; the test does not scan for them.
export const EXTERNAL = [
  { id: 'hubspot-double-opt-in', class: 'transactional', provider: 'hubspot', trigger: 'a HubSpot form with double opt-in is submitted (the EmailCaptureModal / /start form)', template: 'HubSpot marketing email "Opt-in request email (EN_GB)", subject "Please confirm your sign-up"', audience: 'the form submitter', optOut: 'HubSpot footer link sets hs_email_optout; the daily sync records it in THE opt-out', evidence: 'HubSpot portal 246502821, 2026-10: 31 sent, 30 delivered, 1 hard bounce, 0 unsubscribes' },
  { id: 'hubspot-marketing', class: 'non_transactional', provider: 'hubspot', trigger: 'none today (no other marketing email has been sent)', audience: 'HubSpot lists', optOut: 'honours hs_email_optout; our unsubscribe pushes hs_email_optout=true; the daily sync records HubSpot opt-outs in THE opt-out', evidence: 'HubSpot portal 246502821: 0 contacts with hs_email_optout=true, 1 marketing email ever sent' },
  { id: 'newsletter', class: 'non_transactional', provider: 'none', trigger: 'the /newsletter page only stores addresses in public.subscribers; NO code sends a newsletter', audience: 'public.subscribers', optOut: 'the unsubscribe deletes the row AND records the hash; any future send MUST filter through suppressedAmong' },
  { id: 'supabase-auth', class: 'transactional', provider: 'supabase', trigger: 'sign-in / account emails, if enabled in the Supabase project', audience: 'the account holder', optOut: 'not applicable (account security)', evidence: 'no src code calls supabase.auth email flows; not verified in the Supabase dashboard' },
  { id: 'stripe-receipts', class: 'transactional', provider: 'stripe', trigger: 'a payment', audience: 'the payer', optOut: 'not applicable (receipt)', evidence: 'sent by Stripe, not by our code' },
];

// Every way a person can end non-transactional email. All must write THE opt-out.
// NOT an opt-out: "I have fixed this" (MPC-7554) ends the follow-ups for ONE report (scans.fixed_at) and changes nothing else.
export const OPT_OUT_PATHS = [
  { id: 'signed-link', how: 'the Unsubscribe link in our emails -> /unsubscribe -> POST /api/unsubscribe', writes: 'optOutEverywhere()', file: 'workers/scan-report/index.js' },
  { id: 'unsubscribe-page', how: 'the /unsubscribe page, address typed -> confirmation email -> the signed link', writes: 'optOutEverywhere() (via the signed link)', file: 'workers/scan-report/index.js' },
  { id: 'users-column', how: 'any writer that sets users.email_opt_out_at (SQL editor, future path)', writes: 'database trigger mpt_users_opt_out_to_suppression', file: 'supabase/migrations/20261028120000_mpc_7555_one_opt_out.sql' },
  { id: 'hubspot', how: "the unsubscribe link in a HubSpot-sent email (hs_email_optout=true)", writes: 'daily collector hubspot-optout.js -> email_suppressions', file: 'workers/mpt-metrics-collector/collectors/hubspot-optout.js' },
  { id: 'hard-bounce-complaint', how: 'a permanent bounce or a spam complaint reported by the provider (signed webhook, MPC-7556)', writes: 'optOutEverywhere() via lib/receipts.js handleResendWebhook', file: 'workers/scan-report/lib/receipts.js' },
];
