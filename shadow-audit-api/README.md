# shadow-audit-api (MPC-7877)

Standalone Python service (separate from the TS/Cloudflare stack). Stdlib WSGI app (`main:app`, run with gunicorn).

Phase 1: scorer fix, detector errors => INCOMPLETE, canonical Ed25519 signing.
Phases 2-5: 10 detectors (#1, #9, #41, #42, #51, #57, #58, #65, #99, #119), audit orchestration, API routes, Notion/Slack clients, Dockerfile, staging-only cloudbuild.yaml.

Endpoints (X-Api-Token header, or Bearer, except /health): POST /audit/{agent_id}, GET /audit/{id}, GET /agent/{id}/audit-history, POST /audit/{id}/remediate.
Staging by default (`SHADOW_AUDIT_ENV`); the environment is inside the signed passport. Incomplete audits get no passport.

Tests: `python3 -m unittest discover -s tests -v` (20 pass; needs `cryptography`).

Known gaps (see also DEPLOY_COMMANDS.md, SIGNING_KEY_PLAN.md):
- Audit history is in memory per instance; Notion is the durable record (GET /audit/{id} after a restart returns 404).
- BigQuery adapter is untested (no GCP access); all 10 MVP detectors exist, but they are regex heuristics over log text (Risk #1, #42, #99 can false-positive; none prove exploitation).
- Canonicalization is RFC 8785 JCS, not URDNA2015.
- Nothing has been deployed; no GCP resources created.

Log entry fields the detectors read: ts, text, tool, session, vault_start, vault_end, sender, nonce, dest_region.
A pillar with no findings scores 90 ("nothing found"), not "verified safe"; entries missing a field are simply not matched by that detector. Risk #119 allows regions from ALLOWED_REGIONS (default "eu").
