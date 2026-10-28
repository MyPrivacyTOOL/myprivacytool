# Telegram to Web handoff: one footprint count (MPC-8689, built, default off)

## Problem
In Telegram a person sees their 30 hexagons. On the web scan they see only the 54 web ones. The whole footprint is 366 hexagons across 26 channels, so the web
page should show what they already checked in Telegram plus the web checks, and say plainly how many are still to review.
Example: Telegram 30 + Web 54 = **84 of 366 checked, 282 still to review**. Before the web scan finishes: 30 of 366.

## Rule that shapes the design
The web page must never take the Telegram result from the address bar. A number or id list in a URL can be edited, so it would claim checks that never ran,
and "never claim what was not checked" would break. **The server knows what was checked; the URL knows nothing.** (Same reason the dashboard link carries only a random UUID.)

## Flow
1. In the Telegram report the bot offers: "Count this Telegram result in your web scan" with a one-time link `https://www.myprivacytool.io/d/<uuid>`.
   Copy states what is shared: **which hexagons were checked, not your values**.
2. `GET /d/<uuid>` shows one button (previews and crawlers stop here, nothing is used up). `POST` redeems the link atomically and sets the HttpOnly session
   cookie. Both are the existing MPC-7893 mechanics (`shared/dashboard/handlers.ts`, `dashboard_links`, `dashboard_sessions`).
3. The redirect goes to `/scan?handoff=1` (no token, no data in the URL).
4. The web scan calls `GET /api/footprint` (same origin, cookie). The server returns, for the session's sender only, the ids of Telegram hexagons whose check ran in
   their newest complete, unexpired snapshot: state `returned` or `not_returned`, never `not_checked`. Ids only: no values, no names, no photos.
5. In the browser: `footprintSummary([...webCheckedIds, ...telegramCheckedIds])` (shared/hexagon-registry/footprint.js, already built) gives the one number.
   `footprintChannelsLine` shows "Web scan 54 of 83, Telegram 30 of 47". The page labels the Telegram part "from your Telegram scan on <date>".
6. No valid session, expired, or revoked: the page shows the web-only count with no claim about Telegram.

## Scope of the credential (the one real design decision)
The dashboard session lets a person read their own values. The handoff must not hand that to a web scan visitor. Add `scope text not null default 'dashboard'`
to `dashboard_links` and `dashboard_sessions` with values `dashboard | footprint`:
- a `footprint` link is redeemed the same way but its session can read **only** `/api/footprint`; `/api/dashboard` refuses it (403);
- the dashboard link keeps working unchanged (default scope).

## Data contract: `GET /api/footprint`
```json
{ "channels": [ { "channel": "telegram", "checked_ids": ["tg.numeric_id", "..."], "scan_at": "2026-10-28T10:00:00Z", "scan_version": "..." } ] }
```
- Only ids that exist in the catalogue and are `status: "defined"`; anything else is dropped server-side.
- Headers as the dashboard: `no-store, private`, `no-referrer`, `noindex`.
- 401 `no_session`, 503 when the switch is off or storage is unavailable.

## Privacy and honesty controls
- Nothing personal in any URL; the UUID is single use and expires in 15 minutes; only its SHA-256 is stored.
- The web page keeps the ids in memory only: nothing is saved to local storage, the database or analytics.
- "Delete my data" in the bot revokes outstanding handoff links and sessions and deletes the snapshot (existing cascade), so the count disappears.
- A snapshot older than its expiry is never counted.
- Unchecked stays unchecked: `not_checked` Telegram hexagons and all "new" catalogue items are never counted as checked.
- Counts come from the catalogue and the scan. Nothing is typed.

## Rollout gates (same as the dashboard)
- Bot: `TELEGRAM_FOOTPRINT_HANDOFF=on`, allow-listed test accounts only until the MPC-7894 real-user gates are done.
- Pages: `FOOTPRINT_HANDOFF=1`. Default off in both.
- Rollback: turn both off; the migration only adds a column with a default.

## Build list
1. Migration: `scope` column on `dashboard_links` and `dashboard_sessions`; the redeem function returns the scope. (S)
2. `shared/dashboard`: `handleFootprint`, scope check in `handleData`, redirect target by scope. `functions/api/footprint.ts`. (M)
3. Bot: `footprintLinkCommand` (issue a `footprint` link for the newest complete snapshot, rate limit like `/dashboard`), button and copy in the baseline report. (M)
4. Web: `/scan` reads `?handoff=1`, fetches `/api/footprint`, merges into `RiskScore` and the summary card, shows the "from Telegram" label. (M)
5. Tests: vitest for the handlers (scope refusal, one-time use, ids only, expired snapshot), footprint merge, e2e with a mocked `/api/footprint` (84 of 366 shows). (S)
6. Docs: update `docs/telegram-dashboard.md` and the registry README. (S)

## Acceptance
- A person with a Telegram scan opens the link, finishes the web scan, and sees **84 of 366 checked, 282 still to review** with Telegram 30 of 47 and Web 54 of 83.
- The same person without a valid session sees the web-only count and no Telegram claim.
- A `footprint` session cannot read `/api/dashboard`; the URL never contains a count or id.
- Existing dashboard tests pass unchanged.

## Decisions for the owner
1. Wording of the consent line in the Telegram button ("which hexagons were checked, not your values").
2. Show one merged number only, or the merged number plus the per-channel split (recommended: both, as above).
3. Keep it allow-list only until MPC-8652 (the real-product audit of the Find, Delete, Forget rules) is done?

## Status: built, off by default
- Migration `20261028190000_mpc_8689_footprint_handoff_scope.sql` (scope column, 4-argument redeem function). **Merging to main applies it to the live project** (deploy-supabase.yml runs `supabase db push`); it is tested on a throwaway Postgres in CI (`supabase/tests/footprint-handoff.test.sql`).
- Server: `shared/dashboard/handlers.ts` (`handleFootprintLanding`, `handleFootprintRedeem`, `handleFootprintData`, scope refusal in `handleData`), `functions/f/[token].ts`, `functions/api/footprint.ts`, own cookie `__Host-mpt_fp`.
- Bot: `footprint` / `/footprint` command (`workers/social-listeners/src/dashboard-link.ts`), a hint line in the baseline report.
- Web: `src/lib/telegramHandoff.ts` and `RiskScore` (reads `/api/footprint` only when the page is opened with `?handoff=1`).
- Tests: `shared/dashboard/footprint.vitest.ts`, `workers/social-listeners/footprint-link.vitest.ts`, `src/lib/telegramHandoff.test.ts`.
- To turn on (in this order): merge (the migration is applied by the workflow); set Pages `FOOTPRINT_HANDOFF=1`; set the Worker `TELEGRAM_FOOTPRINT_LINKS = "on"` (allow-listed `PROBE_TELEGRAM_IDS` only). To turn off: unset either switch. "Delete my data" deletes the snapshot, which cascades to its links and sessions, so the Telegram part disappears from the web count.
- Decisions taken (the recommended ones): consent line "shares which hexagons were checked, not your values"; merged number plus the per-channel split; allow-list only until MPC-8652.
