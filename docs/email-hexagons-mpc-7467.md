# Email hexagons (MPC-7467)

Four checks run on the address the user gave, inside the `mpt-scan-report` Worker, when a report is prepared (`workers/scan-report/lib/emailHexagons.js`). Each result is FOUND / CHECKED AND CLEAR / NOT CHECKED and is stored as a `signals` row (`category='email'`, `signal_type` = hexagon id) with the scan. They do not change the privacy score and **no email content changed**. Each outside call has a 3 s limit (`EMAIL_HEXAGON_TIMEOUT_MS`); a failure or timeout is NOT CHECKED and the report still goes out.

| Hexagon id | Status | Source |
|---|---|---|
| `email-breaches` | **Not built** (see below) | XposedOrNot via the MPC-7252 code |
| `email-name` | Built | Local logic only |
| `email-provider` | Built | Cloudflare public DNS-over-HTTPS |
| `email-profile` | Built | Gravatar |
| `email-libravatar` | Built (MPC-8452) | Libravatar (hash only) |
| `email-domain-record` | Built (MPC-8452) | RDAP via rdap.org (domain only) |

## Outside services that receive the address or a hash of it (for MPC-7470, privacy policy)
1. **Cloudflare DNS-over-HTTPS** (`cloudflare-dns.com/dns-query`): receives the **domain only** (the part after the @), e.g. `gmail.com` and `_dmarc.gmail.com`. Not the part before the @.
2. **Gravatar** (`gravatar.com/avatar/<hash>`, `api.gravatar.com/v3/profiles/<hash>`): receives a **SHA-256 hash of the lower-cased address**, not the address itself. A hash of a known address can still be matched by anyone who tries that address, so the policy should call it pseudonymous, not anonymous.
3. **Libravatar** (`seccdn.libravatar.org/avatar/<hash>`, MPC-8452): receives a **SHA-256 hash of the lower-cased address**, like Gravatar.
4. **rdap.org and the domain registry it redirects to** (MPC-8452): receive the **domain only**, for domains that are not shared webmail domains.
5. **GitHub commit search** (`api.github.com/search/commits`, MPC-8452 Tier 2, built but OFF by default): receives the **plain address**. This is the only check that does. Details and switch: `docs/osint-list-mpc-8452.md`.
6. Not built yet: the breach source. If XposedOrNot is used it receives the **full address**.
7. Existing, unchanged: Supabase (stores it), Resend (sends the email), HubSpot (contact).
No other service is contacted. No company's sign-up or login page is probed.

## Breach check: held, terms not confirmed
The merged MPC-7252 code (`workers/mirror-risk`, `BREACH_PROVIDER = "xposedornot"`) calls XposedOrNot; its `wrangler.toml` already carries a TODO that its commercial-use terms are unconfirmed. The terms could not be read from the build environment (egress to `xposedornot.com` is blocked by the environment's network policy), so the check was not built. Options: (a) allow `xposedornot.com` for the environment so the terms can be read, or have the owner read https://xposedornot.com/terms and paste the wording; (b) use HIBP, which is paid (Core plan cannot search arbitrary addresses), so it fails the no-paid-services rule; (c) leave breaches on the existing "check it yourself at haveibeenpwned.com" link, which is what the report does today. Once confirmed, the simpler deploy path is to move the check into the report Worker (it already has `lib/hibp.js` and the signals plumbing) rather than add a separate deploy workflow for `mirror-risk`.

## Not verified against live services
Tests use stubbed `fetch`. The Cloudflare DoH JSON format is documented and stable; the Gravatar v3 profile endpoint and its unauthenticated rate limit were not exercised live (the build environment cannot reach either host). A rate-limited response gives NOT CHECKED, never CLEAR.

The wider list of checks, tiers and rules is in `docs/osint-list-mpc-8452.md`.
