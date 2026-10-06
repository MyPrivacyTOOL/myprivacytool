# MPC-6965 agent cutover package (PREPARED, NOT DEPLOYED)

Moves the `myprivacytool` agent's operational writes from Notion to the Supabase `mpt_*` tables through the already-merged router tool `mpt_supabase_write` (krispyking/openclaw26 #941 tool, #945 grant). **Nothing in this package is applied.** It changes no key, no droplet, no agent instruction, no Notion page.

## Task record (FLEET-TASK-V4.2)

| Field | Value |
|---|---|
| Goal | When the gates below are open, the agent records scans, rate-limit counters and channel metrics in Supabase and stops writing them to Notion. |
| Scope | Agent instruction text (Notion pages listed in the inventory) and the verification run. Repos: this one for the package; `krispyking/openclaw26` only for the already-merged tool and grant. Tables: `mpt_osint_scan_results`, `mpt_api_rate_limits`, `mpt_channel_metrics`. `mpt_user_engagement` is written by the `mpt-leads` Worker, not the agent. |
| Out of scope | Rotating keys; installing `SUPABASE_SECRET_KEY_MYPRIVACYTOOL` on the droplet (MPC-6950); switching the agent now; backfilling Notion history (decision D5: forward-only); archiving the Notion databases (D6: after verified cutover). |
| Acceptance criteria | From MPC-6965: (1) a scan by the agent inserts 1 row in `mpt_osint_scan_results` and 0 new rows in the Notion OSINT Scan Results DB; (2) `mpt_api_rate_limits` and `mpt_channel_metrics` each receive rows within 24h of cutover; (3) rows with `expires_at < now()` count 0 after each purge run; (4) the anon key returns 0 rows for all four `mpt_*` tables. `verify-cutover.mjs` checks all four as AC1a/b, AC2a/b, AC3, AC4. |
| Rollback plan | `rollback-plan.md`: restore the saved pre-cutover Notion instruction text, remove the key from the agent environment, confirm with `verify-cutover.mjs --phase rollback`. Supabase rows are additive and stay. |

## Gates (all must be true before step 1)

| Gate | State at 2026-10-06 | Source |
|---|---|---|
| `mpt_supabase_write` merged in the router | MERGED (openclaw26 #941) | MPC-6965 page |
| Grant to `myprivacytool` merged | MERGED (openclaw26 #945); not yet observed in `/opt/openclaw/` | MPC-6965 page |
| MPC-6950 audit done and key rotated | OPEN (blocks everything below) | Ops page §8 |
| `SUPABASE_SECRET_KEY_MYPRIVACYTOOL` installed on the droplet | NOT DONE, forbidden until the audit | MPC-6965 page |
| Purge of expired rows | LIVE (pg_cron hourly) | MPC-6965 page |
| Pre-cutover snapshot of the current instruction text taken | NOT DONE | `rollback-plan.md` |
| Q11 answered: where the agent's real write instructions live | OPEN, see inventory | `notion-write-instructions-inventory.md` |

## Runbook (for the day the gates open)

1. Take the snapshot required by `rollback-plan.md` (copy the current text of every page edited below).
2. Human installs the key per the audit's procedure. Run `verify-cutover.mjs` once with the old instructions in place to confirm AC4 and AC3 already pass and the tool works: a manual `mpt_supabase_write` test row, then delete it.
3. Replace the instructions with `agent-instructions-v2.md` (edit only the pages the inventory marks "edit").
4. Note the time. Trigger one real scan.
5. `node verify-cutover.mjs --since <that time>`; after 24h run it again for AC2.
6. All PASS: archive the Notion databases (D6) and update the Architecture page. Any FAIL: roll back.

Tests for the verification script: `node --test docs/cutover/mpc-6965/verify-cutover.test.mjs` (10 passing, mocked).
