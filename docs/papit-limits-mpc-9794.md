# MPC-9794 (EXT-07): checksums vs authenticity; expiry and revocation

STEP 0 on main 136b24b, 2026-11-18. Decision Q9 (Chris, 2026-11-18): reword now, sign later (ed25519 deferred).

| Acceptance | Before | After this PR |
|---|---|---|
| (a) checksum-only | FALSE: /developers said "verify that a profile you received has not been edited"; the snippet said "detect any edit"; schema-v1.md and the GitHub guide said "any later edit is detectable" | TRUE: all five places say checksum, separate trusted channel, does not prove who produced it |
| (b) authenticity claims | FALSE: nothing stated the receipt is unkeyed (papit.js:114, an editor can recompute it) | TRUE: stated on /developers (PaPIT section), the verify snippet, the guide, schema-v1.md; the sanitization receipt is stated to be a hash, not a signature or ZKP |
| (c) expiry and revocation | FALSE: `data_retention_days: 30` and `revocable: true` were shown as facts; "Snapshot valid for 30 days" on Connect GitHub | PARTIAL, now stated truthfully: 30 days declared, not enforced; 24 h cache (cache.js:6); 7-day session (index.js:25); token kept until disconnect; disconnect revokes the token and clears the cache; an issued profile cannot be recalled, no revocation list |

New `PAPIT_LIMITS` list on /developers; test pins the wording and the lifetimes against the Worker constants.

Not done (follow-ups): ed25519-signed profiles; enforcing the 30-day validity (or dropping the field); token expiry. The `revocable: true` field value is left as is: it means the user can disconnect.
