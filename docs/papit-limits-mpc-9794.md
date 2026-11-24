# MPC-9794 (EXT-07): checksums vs authenticity; expiry and revocation

STEP 0 on main 136b24b, 2026-11-18. Decision Q9 (Chris, 2026-11-18): reword now, sign later (ed25519 deferred).

| Acceptance | Before | After this PR |
|---|---|---|
| (a) checksum-only | FALSE: /developers said "verify that a profile you received has not been edited"; the snippet said "detect any edit"; schema-v1.md and the GitHub guide said "any later edit is detectable" | TRUE: all five places say checksum, separate trusted channel, does not prove who produced it |
| (b) authenticity claims | FALSE: nothing stated the receipt is unkeyed (papit.js:114, an editor can recompute it) | TRUE: stated on /developers (PaPIT section), the verify snippet, the guide, schema-v1.md; the sanitization receipt is stated to be a hash, not a signature or ZKP |
| (c) expiry and revocation | FALSE: `data_retention_days: 30` and `revocable: true` were shown as facts; "Snapshot valid for 30 days" on Connect GitHub | PARTIAL, now stated truthfully: 30 days declared, not enforced; 24 h cache (cache.js:6); 7-day session (index.js:25); token kept until disconnect; disconnect revokes the token and clears the cache; an issued profile cannot be recalled, no revocation list |

New `PAPIT_LIMITS` list on /developers; test pins the wording and the lifetimes against the Worker constants.

Not done (follow-ups): ed25519-signed profiles; enforcing the 30-day validity (or dropping the field); token expiry. The `revocable: true` field value is left as is: it means the user can disconnect.

## Update MPC-10833 (2026-11-24, Chris: "Y" to the recommendation)

Row (c) is now enforced, not only stated:

- Every profile has `privacy_boundaries.expires_at` (generated_at + 30 days, inside the receipt). The Worker's cache drops a profile past it and `verifyProfile()` refuses it; a profile made before the field existed expires 30 days after `generated_at`. A copy already issued still cannot be recalled, so consumers must check `expires_at` themselves.
- A stored token is used for at most 90 days after the person last agreed. `channel_tokens.consented_at` is set by the OAuth callback only (a refresh does not move it). After 90 days the Worker deletes the token, revokes at the provider and answers `401 reconsent`. `mpt_purge_stale_channel_tokens()` (migration 20261124070000) deletes rows nobody will use again; it is not scheduled (deleting data needs Chris's go-ahead).
- Deploy order: apply the migration first, then the Worker.
