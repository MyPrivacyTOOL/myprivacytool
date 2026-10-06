# MPC-6965 rollback plan

## When to roll back

Any of: `verify-cutover.mjs` reports FAIL on AC1a, AC2 or AC4 and the cause is not fixed within the working day; the tool returns "nothing was recorded" for real scans; rows appear in both stores (dual write); a privacy concern with `user_handle` data; the owner asks.

## Before cutover (required, or the rollback cannot be done)

1. Copy the **exact current text** of every page marked "Edit" in the inventory (rows 1, 7, 8) and the matching lines in `agents/myprivacytool/*` (row 10) into a dated Notion page "MPC-6965 pre-cutover snapshot". Page version history is a second copy, not the only one.
2. Note the cutover time (UTC) for `--since`.

## Steps

1. **Stop the writes.** Restore the snapshot text on the edited pages, and in `agents/myprivacytool/*` if row 10 was changed (revert that commit in `krispyking/openclaw26`; main auto-deploys the fleet, so a human merges).
2. **Remove the key from the agent.** Human deletes `SUPABASE_SECRET_KEY_MYPRIVACYTOOL` from the droplet environment and restarts the router. With no key the tool records nothing, which is the safe state. Optional: remove `mpt_supabase_write` from `agents.myprivacytool.grants` in `tool-capability-registry.json` (a one-line revert of #945); leave it if the cutover will be retried soon.
3. **Verify.** `node verify-cutover.mjs --since <rollback time> --phase rollback` shows RB1 PASS (new Notion rows) and RB2 PASS (no new Supabase rows). Run one real scan to produce a row.
4. **Record.** Append the reason and the state word to the MPC-6965 page.

## What stays

- Supabase rows written during the cutover window stay. They are additive, expire after 24 hours (scan results) and need no cleanup. Rate-limit and metric rows are small and keyed, so a retry overwrites them.
- Not copied back to Notion: the window's scan rows (they are gone in 24h anyway); rate limits and metrics for that window are re-entered by the next normal run. Decision D5 (forward-only, no backfill) applies in both directions.
- The pg_cron purge, the RLS policies and the router tool are untouched.

## Not rolled back (and why)

Key rotation (MPC-6950). Rotating a key that was exposed is independent of this cutover and is never undone.

## Rollback test

Dry-run the plan once before cutover day: edit a copy of one page, restore it from the snapshot, confirm the text is identical. The rollback-phase checks of the verification script are covered by its tests (`verify-cutover.test.mjs`, last test).
