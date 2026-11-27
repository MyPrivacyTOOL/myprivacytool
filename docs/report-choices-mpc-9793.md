# MPC-9793 (EXT-06): report, attachment, storage choices, baselines

STEP 0 run 2026-11-18 against main 136b24b and the live site (version.json 136b24b).

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 0 | Report availability and timing claims; baseline `score_version` stamping | ALREADY DONE | MPC-9833 (#748, #758), docs/report-delivery-proof-mpc-9833.md; workers/mpt-leads/worker.js:716-771 (`score_version`, `comparable`) |
| 1 | PRIVACY-020 warning on the emailed JSON and in the FAQ | STILL OPEN, fixed in this PR (copy: draft for review) | `ATTACHMENT_WARNING` in workers/scan-report/lib/email.js (text and html); FAQ "What is the JSON file?"; tests in report-email.test.mjs, snapshots updated (pure insertion). A redacted copy is NOT built: follow-up task |
| 2 | UX-026 report delivery, saved scan, follow-ups, marketing as separate choices | PARTIAL | See below |
| 3 | UX-031 baseline reset, correction, comparability | PARTIAL | Different `score_version` => `comparable:false`, `delta:null` is in the Worker (mpt-leads worker.js:769-771). No visitor-facing "not directly comparable" label, no "start fresh" (archive) action: needs a migration and UI, follow-up task |
| 4 | CK-9848 retention of the scans row | ALREADY DONE | MPC-9890: `mpt_purge_free_records` deletes `scans`, `web_scans`, `scan_consents`, `scan_recipient_log`, orphan users and leads (supabase/migrations/20261108210000_mpc_9890_free_record_deletion.sql:174-183); `FREE_RECORD_DELETION_ENABLED = "true"` in workers/scan-report/wrangler.toml:36 |
| 5 | Delivery timing at different UTC hours with a real inbox | BLOCKED | Needs a team-owned inbox and a live scan request (MPC-10804, MPC-10817) |

## Item 2: what each choice maps to in code

- **Scan consent** (the Scan me press): `POST /api/consent` records `scan_consents`; the report job refuses a scan with no consent id once `CONSENT_GATE_ENFORCED` is on (workers/scan-report/index.js:110-126, 372-380).
- **Report delivery**: the request itself (`consent === true`) and the email confirmation gate.
- **Saved scan**: its own `save_consent === true`; without it nothing is stored (index.js:136-148).
- **Follow-up emails**: NOT a separate choice. They start for every sent report (`runFollowUpJobV2`, index.js:528+) and stop on "I have fixed this" or unsubscribe. The only control is unsubscribe, which also stops everything non-transactional.
- **Marketing**: no marketing consent exists and no marketing send path was found in the scan-report Worker. The unsubscribe wording ("follow-up or marketing emails") covers it in advance.

So report and saved scan are separate; follow-ups and marketing are not separate choices today. Whether they should be is a decision for Chris, tracked in the follow-up task.
