# shadow-audit-api (MPC-7877) — Phase 1

Standalone Python service (separate from the TS/Cloudflare stack). Phase 1 = scaffolding + TDD fixes only.
No credentials, deploys, Notion DB or cron yet (each needs separate sign-off). See SIGNING_KEY_PLAN.md.

Run tests (stdlib unittest; needs `cryptography`): `python3 -m unittest discover -s tests -v`

Fixed in Phase 1: scoring formula (saturating, Risk #57 ≈ 26), detector failures mark the audit INCOMPLETE, passports signed over canonicalized JSON-LD bound to proof options.
Known gap: canonicalization is RFC 8785 JCS over an inline-context document; URDNA2015 via pyld is a follow-up.
