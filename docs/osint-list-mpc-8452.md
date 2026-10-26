# OSINT list for the live scan (MPC-8452)

What we look up about the address a visitor gives us, how it reaches the page (live view, `workers/scan-report/lib/live.js`) and the report email, and what we will NOT do. Every check returns FOUND / CHECKED AND CLEAR / NOT CHECKED, never a guess; a failed or unavailable lookup is NOT CHECKED, never clear.

Rules every check must meet before it is built:
1. **Free and public.** No paid API, no scraping, no login.
2. **Privacy by construction.** Only the domain (the part after the @) or a SHA-256 hash of the address leaves our Worker. The plain address goes to no third party. (Exception that needs the owner's written approval and a privacy-policy change first: see Tier 2.)
3. **No probing of other companies' sign-up or login pages** ("is this email registered on site X"). That is the technique used to track people, and it can alert the third party.
4. **Disclosed.** Every outside service is named in the Privacy page ("Email Checks for Your Report") before the check runs.
5. **Honest and bounded.** 3 second timeout per check, results are facts from a source we name, a missing answer is NOT CHECKED.
6. **Live view shows facts, not values, until the inbox is proven** (the email link). See `workers/scan-report/README.md`.

## Tier 1: built (batch 1 adds the last two)

| Hexagon id | What it looks at | What leaves the Worker | Source |
|---|---|---|---|
| `email-name` | Name or birth-year pattern in the part before the @ | nothing (local logic) | none |
| `email-provider` | Who runs the mail, SPF and DMARC of the domain | the domain | Cloudflare DNS-over-HTTPS |
| `email-profile` | Public Gravatar avatar or profile | SHA-256 hash | Gravatar |
| `email-libravatar` (new) | Public Libravatar avatar | SHA-256 hash | libravatar.org |
| `email-domain-record` (new) | Public registration record of a domain that is yours: registration year, registrar, whether the owner's name, organisation, email, address or phone is visible. Skipped (clear) for shared webmail domains | the domain | RDAP via rdap.org and the registry |

## Tier 2: possible, needs the owner's decision (the plain address would go to a third party)

| Idea | What it would show | Why it is held |
|---|---|---|
| Public code commits | Whether the address appears as the author of public GitHub commits (a common, avoidable exposure) | The plain address goes to GitHub's search; Privacy page and sub-processor wording need changing first |
| PGP key servers | Whether a public encryption key is published for the address | The plain address goes to the key server |
| Web archive mentions | Whether the address appears on archived public pages | The plain address goes to the archive; results are noisy |
| Known breaches (`email-breaches`) | Whether the address is in a known data breach | Registered but NOT BUILT since MPC-7467: the source's commercial-use terms were never confirmed, and a paid key (Have I Been Pwned) would be the clean route. The plain address goes to the provider |

### Owner decision, 2026-10-26 (given in chat; recorded here, not yet built)

The owner approved the recommendation on the ticket: **GitHub public commit search** and **a paid-key breach source** may receive the plain address, each only after its Privacy page wording is approved and live (rule 4 above). **PGP key servers and web archive mentions are not approved** and stay held.

Why nothing is built yet (what must exist first):
1. **GitHub commit search** (`GET https://api.github.com/search/commits?q=author-email:<address>`): unauthenticated search is limited to about 10 requests a minute per IP, and Workers share IPs, so without a token most lookups would end as NOT CHECKED. Needs a GitHub token with no scopes (public data only) stored as a Worker secret, set by a human. A check must return FOUND only for a real match, CLEAR only for a 200 with zero results, and NOT CHECKED for 403, 422, 429, timeouts and anything else.
2. **Breach source:** the paid-key route is Have I Been Pwned. Rule 1 (free and public) is waived for this one source by the owner's approval, but a key has to be bought and set as `HIBP_API_KEY`, and the plain address then goes to that provider. `email-breaches` is already registered; its provider wiring is what is missing.
3. **Privacy page** wording naming each provider (see "Adding a check", step 4), approved by Chris and deployed before either check runs.
4. **Careful wiring.** `workers/scan-report/lib/live.js` marks the live view done when the number of finished items reaches `Object.keys(EMAIL_HEXAGONS).length`. A check that is registered but switched off would leave the live view on "still looking" for ever, so a switch must remove the check from the count as well as from `runEmailHexagons`. The registry count in `report-email.test.mjs`, `live.test.mjs`, `worker.test.mjs` and `registry.test.mjs` moves with every added check.

## Tier 3: possible with more work (domain only, but slow or noisy)

| Idea | What it would show | Note |
|---|---|---|
| Certificate transparency for your own domain | Hostnames the domain has public certificates for (mail., vpn., staging.) | crt.sh is slow and flaky inside 3 seconds: run it as a queued job, not an inline check |
| Web Key Directory | Whether your own mail server publishes a PGP key for the address | Sends a hash of the local part to the domain's own server; only meaningful for own domains |
| Mail transport protection | MTA-STS, TLS-RPT and BIMI records of your own domain | Small value for most visitors |

## Not allowed (never)

- Checking whether the address has an account on any other site (sign-up or password-reset probing).
- Data-broker, people-search or social-network scraping. The report links removal guides and says plainly that we have not searched those sites.
- Searching for anything about a person other than the address the visitor gave us, or showing results to someone who has not proven they own the inbox.
- Paid enrichment of the address or name (credit headers, "find email owner" services).

## Adding a check

1. Add the check in `workers/scan-report/lib/emailHexagons.js` (return `found` / `clear` / `not_checked`, 3 s timeout, never throw) and register it in `EMAIL_HEXAGONS` there.
2. Add its entry to `EMAIL_HEXAGONS` in `shared/hexagon-registry/registry.js`, then run `node workers/scan-report/scripts/sync-hexagons.mjs`.
3. Tests: success, clear, not_checked on every failure, only the allowed data is sent, hung lookup is cut off.
4. Disclose the service on the Privacy page and in `docs/email-hexagons-mpc-7467.md`. Update the counts in `report-email.test.mjs`.
