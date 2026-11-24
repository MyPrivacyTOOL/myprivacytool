# MPC-9794 (EXT-07): checksums vs authenticity; expiry and revocation

STEP 0 on main 136b24b, 2026-11-18. Decision Q9 (Chris, 2026-11-18): reword now, sign later (ed25519 deferred).

| Acceptance | Before | After this PR |
|---|---|---|
| (a) checksum-only | FALSE: /developers said "verify that a profile you received has not been edited"; the snippet said "detect any edit"; schema-v1.md and the GitHub guide said "any later edit is detectable" | TRUE: all five places say checksum, separate trusted channel, does not prove who produced it |
| (b) authenticity claims | FALSE: nothing stated the receipt is unkeyed (papit.js:114, an editor can recompute it) | TRUE: stated on /developers (PaPIT section), the verify snippet, the guide, schema-v1.md; the sanitization receipt is stated to be a hash, not a signature or ZKP |
| (c) expiry and revocation | FALSE: `data_retention_days: 30` and `revocable: true` were shown as facts; "Snapshot valid for 30 days" on Connect GitHub | PARTIAL, now stated truthfully: 30 days declared, not enforced; 24 h cache (cache.js:6); 7-day session (index.js:25); token kept until disconnect; disconnect revokes the token and clears the cache; an issued profile cannot be recalled, no revocation list |

New `PAPIT_LIMITS` list on /developers; test pins the wording and the lifetimes against the Worker constants.

Not done (follow-ups): ed25519-signed profiles; enforcing the 30-day validity (or dropping the field); token expiry. The `revocable: true` field value is left as is: it means the user can disconnect.

## Update MPC-10833 (Chris, 2026-11-23: enforce the validity; give the token an expiry)

- **Profile validity is enforced.** Every profile (GitHub and Reddit) carries `expires_at` = `generated_at` + 30 days, inside the checksum (editing it breaks the receipt). `getCached` (lib/cache.js) refuses a profile with no readable `expires_at` or one past it; `isExpired` (lib/papit.js) is the same rule for consumers. The 24 h cache is shorter than 30 days, so in practice a served profile is always valid; the check is the guarantee.
- **The token has a 90-day consent.** `channel_tokens.created_at` is the consent time: only the OAuth callback writes it (`saveToken(..., consent: true)`); a token refresh does not (the upsert leaves the column alone), so a refresh does not restart the 90 days. When a profile is requested and the consent is 90 days old (or its date is missing or unreadable: fail closed), the Worker deletes the token row, revokes the grant at GitHub or Reddit, clears the cache and answers `401 {"error":"reauthorize","reason":"consent_expired"}`. The page already shows its reconnect prompt for `reauthorize`. Connecting again restarts the 90 days.
- **Slack of up to 24 h.** The check runs when the token is read, which is on a cache miss. A profile cached just before day 90 is served for at most 24 hours longer; the token is deleted at the next miss.
- **Existing connections.** Rows older than 90 days at deploy time are asked to reconnect on their next profile request.
- **Not done.** No revocation list for issued profiles (a copy already shared cannot be recalled); signing is still planned.
