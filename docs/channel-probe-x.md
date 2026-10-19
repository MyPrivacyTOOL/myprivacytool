# Channel probe: X (hexagon block 57)

Same idea as the Telegram probe (`docs/channel-probe.md`): measure what X really delivers, so the Channel Signal Availability rows can rest on evidence.
Two parts: what the event gives us, then what a public lookup of that account returns (the OSINT step, no login).

## What it does
With **PROBE_MODE=on** and an X event from an account on **PROBE_X_IDS** (numeric X user ids) or **PROBE_X_HANDLES** (@handles, any case), both
comma-separated plain vars, it saves to `public.channel_probe_captures` (platform `x`, 7 day expiry, service_role only):
1. `update`: the raw webhook payload exactly as delivered (DM events, plus the `users` map X attaches).
2. `lookup:users`: the raw `GET /2/users/:id` answer with every user field we can ask for (`fields: "full"`). If X refuses a field name (400) the documented fields are used
   instead (`fields: "safe"`) and the refused attempt is kept in `full_attempt`.
3. `lookup:users/tweets`: the raw answer for the five latest public posts, with the rate-limit headers, so refusals and costs are evidence too.

Who counts as the account: the sender of a DM, the author of a mention, a new follower, or someone who liked a post. Our own account's events are never captured.

## What it does not do
- Anyone not on the lists takes the normal path untouched: nothing is saved, no extra X calls (each lookup spends X API credits).
- Default is off (PROBE_MODE unset). Mode `all` does nothing for X.
- It never changes the Mirror bot or the webhook response: it runs beside them, errors are swallowed, and a failure cannot reach the reply.
- The bearer token is never written to a row or a log.
- Only add accounts that are ours or whose owner agreed. The live Mirror bot still tells a DM sender "I keep none of your profile data"; that statement is not true for an account on these lists.

## Test steps
1. Set the plain vars on the `social-listeners` Worker: `PROBE_MODE=on` and `PROBE_X_HANDLES=<your test handle>` (or `PROBE_X_IDS`).
2. From that account, DM the MyPrivacyTOOL X account (any text), then send `MIRROR` and reply `Y` to see the full flow.
3. Read the rows:
```sql
select kind, created_at, payload from public.channel_probe_captures
where platform = 'x' order by created_at desc;
```
4. Compare with the Channel Signal Availability rows for X. Tick Verified only when a saved payload shows the field; record the capture date in Notes.
5. Finished: unset `PROBE_MODE`. Rows expire after 7 days (`select public.mpt_purge_expired_channel_probe_captures()`).

## Rollback
Unset `PROBE_MODE`. To remove the code, revert the guarded block in `src/x-webhook.ts` and delete `src/x-probe.ts`.
