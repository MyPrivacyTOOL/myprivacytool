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
| Public code commits | Whether the address appears as the author of public GitHub commits (a common, avoidable exposure) | **Built, OFF** (owner approved 2026-10-26): see the decision below |
| PGP key servers | Whether a public encryption key is published for the address | The plain address goes to the key server |
| Web archive mentions | Whether the address appears on archived public pages | The plain address goes to the archive; results are noisy |
| Known breaches (`email-breaches`) | Whether the address is in a known data breach | Registered but NOT BUILT since MPC-7467: the source's commercial-use terms were never confirmed, and a paid key (Have I Been Pwned) would be the clean route. The plain address goes to the provider |

### Owner decision, 2026-10-26 (given in chat)

The owner approved **GitHub public commit search** as the Tier 2 check, and said **no money is to be spent on Have I Been Pwned**. PGP key servers and web archive mentions are not approved and stay held.

**`email-github-commits` is built and ON** (Worker var `EMAIL_GITHUB_COMMITS_ENABLED = "true"` in `workers/scan-report/wrangler.toml`, switched on by the owner's instruction after the Privacy page sentence went live; only the exact string `"true"` runs it, and `"false"` is the rollback).
- It sends the **plain address** to `api.github.com/search/commits?q=author-email:<address>`, one request per run. It is the only check that does. The Privacy page states it.
- FOUND: GitHub reports at least one public commit (count and one repository name; the name shows only in the inbox-verified view and the report). CLEAR: HTTP 200, zero results, not marked incomplete. NOT CHECKED: anything else (403, 429, 422, 5xx, incomplete results, timeout, bad body). GitHub indexes only default-branch commits, so CLEAR never means "appears nowhere".
- Optional Worker secret `GITHUB_SEARCH_TOKEN` (a GitHub token with **no scopes**, free). **Not set yet**, so the search allows about 10 requests a minute per IP and Workers share IPs: expect many NOT CHECKED results until a human sets it (Cloudflare dashboard -> Workers -> mpt-scan-report -> Settings -> Variables and Secrets). It is deliberately not in `EXPECTED_SECRETS.txt`, so the deploy does not need it.
- The live view's "done" count uses `enabledEmailHexagonIds(env)` (`lib/emailHexagons.js`), so turning the switch off again does not leave the live view waiting for a check that no longer runs.
- It is in the registry (`shared/hexagon-registry`, 7 email hexagons) and so in every report email, FOUND with a result and NOT CHECKED without one. The worst-case report is 91 KB (limit 100 KB).
- The report job and the live run each call the check, so one scan can make two GitHub searches.

**Breach source (`email-breaches`): stays NOT BUILT, and the free route is closed.** No paid Have I Been Pwned key, and we will not build our own breach database (collecting leaked data to search it is a legal and ethical risk we do not take). The one free public API, XposedOrNot, is closed to a product by its own terms. Read on 2026-10-26 at https://xposedornot.com/terms (terms last updated July 2026), section 4 (Acceptable Use), verbatim: "Commercial use of our data requires a proper licensing agreement." Its API documentation also limits the free tier to 2 requests a second, 25 an hour and 100 a day per IP and says it is "for personal and low-volume use"; Workers share egress IPs, so the limits would be hit at once. Options if breaches are wanted: a licensing agreement or paid plan with XposedOrNot (owner's call; the plain address goes to that provider and needs its own Privacy sentence), or keep the report's link to the free self-check at haveibeenpwned.com, which is what it does today.

**GitHub check verified against the real API on 2026-10-26** (from a networked sandbox; the build sandbox cannot reach GitHub): the exact request the Worker makes returns HTTP 200 with `total_count` and `incomplete_results`; an address with public commits returns a count (and `incomplete_results: true` can accompany a non-zero count, which the check treats as FOUND); an address with none returns `total_count: 0, incomplete_results: false` (CLEAR); the unauthenticated limit is 10 requests a minute (`x-ratelimit-limit: 10`), which is why `GITHUB_SEARCH_TOKEN` matters.

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
