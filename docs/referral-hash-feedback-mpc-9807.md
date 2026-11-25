# MPC-9807 (EXT-20): password-check wording, referral disclosures, where the invite address and its hash go, feedback confidence

Checked 2026-11-18 against main HEAD 136b24b.

## (1) Password check wording (PRIVACY-029)

The browser makes a SHA-1 fingerprint of the password, sends only its first 5 characters to Have I Been Pwned (k-anonymity), and matches the returned suffixes itself (registry key `pwned-passwords`, shared/recipients/recipients.json; src/components/PasswordCheck.tsx). "A scrambled code" was replaced by "a one-way fingerprint ... a lookup identifier" on the page and in the generated Privacy/Cookies sentence (shared/recipients/disclosure.ts `password_hash_prefix`).

## (2) What the inviter sees (UX-039, PRIVACY-030)

- On each friend's first completed report the inviter is emailed "A friend you invited got their first privacy report. That earns you one free month of Pro." with their running total of free months (workers/scan-report/lib/referralEmail.js 53-69): **an individual qualifying event, no identity, no results.**
- Their invite page shows **counts only**: sent, signed up, completed (`POST /api/referral/status`, workers/scan-report/lib/referral.js 111-127).
- Names are never stored, and nothing about a friend's results is shown to the inviter (referral.js header 1-7). Privacy section 16 now says exactly this.

## (3) Where the invited address and its hash go (PRIVACY-031)

| Step | What holds what | Source |
|---|---|---|
| Referrer types up to 10 addresses | the Worker holds the plaintext in memory for the request | referral.js 129-160 |
| Our database | `referrals.invitee_hash` = SHA-256 of the lower-cased address, **unsalted**; `email_suppressions.email_hash` the same function after an unsubscribe | workers/scan-report/lib/suppression.js 6-8; referral.js 153-157 |
| Email provider | the **plaintext address** is sent to Resend (`to: [to]`) to deliver the invite; Resend keeps delivery records under its own retention | workers/scan-report/lib/email.js 287; registry key `resend` |
| The email itself | the unsubscribe link and the `List-Unsubscribe` header carry the **plaintext address** in the query string (`/unsubscribe?e=<address>&t=<token>`, `/api/unsubscribe?e=...`) | workers/scan-report/lib/onboarding.js 24-32 |
| Our logs | no address: failures log a reason, errors replace anything shaped like an address with `[email]` | referral.js 90, 94, 164 |
| Queue | none: the send is synchronous | referral.js |

So "we keep only a hash, never the address" is true for our own tables but not for the whole path: the address is at the email provider, and it is in the unsubscribe URLs, so it can appear in request logs when the recipient uses the link. The hash is a lookup key, not anonymisation: with a guessed address anyone holding the table can confirm it. Privacy section 16 now says this.

**Not fixed here (code change, filed as a follow-up):** put a signed token only in the unsubscribe links (no `e=` address) and keep `/unsubscribe` out of analytics page URLs. If a recipient who has allowed analytics opens the unsubscribe page, the page URL with the address is what the analytics tag would record; this was not tested live.

## (4) Feedback confidence (TRUST-019, DATA-001)

- **Returning-device "welcome back"** (workers/scan-report/lib/recognise.js, src/components/WelcomeBack.tsx): the Worker returns `agreement` (weighted share of signals that matched) and `threshold` (`MIN_AGREEMENT = 0.85`) as separate fields, with `MIN_EVIDENCE = 12` and `MIN_HASHES = 1`; the page shows the date, the signals that matched and a caveat, and **does not show the agreement or threshold numbers**, so nothing conflates them. TRUE.
- **Hexagon answers** (supabase/migrations/20261019180000_hexagon_learning_events.sql): each event stores `confidence_at_display` and `config_version`; roll-ups are keyed by `config_version`; `confidence_config` is versioned and proposals are never applied automatically (a human sets a version). Feedback is therefore versioned against the confidence in force. TRUE.
- "Prediction confidence" shown beside a hexagon is the registry's fixed number (config version 0) until a human sets a version. TRUE; no wording change.
