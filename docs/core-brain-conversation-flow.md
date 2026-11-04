# Core Brain conversation flow (what the bot says, what we learn, what is switched on)

Written 2026-10-29 from the code on `main` (Claude Code session, MPC-7284 follow-up). Every statement below comes from reading
`workers/core-brain/index.ts`, `workers/social-listeners/src/*.ts` and `locales/en/main.json`, not from watching the live bot.
**Which switches are ON in production is not verified**: they are Worker variables that cannot be read from the repo. Check
them in the Cloudflare dashboard (Workers -> social-listeners -> Settings -> Variables) before relying on the "gated" rows.

How the pieces fit: Telegram/X -> `social-listeners` (checks the message, sends the reply) -> `core-brain` (works out the intent,
looks up the sender's state, answers with a message KEY, never text) -> `social-listeners` turns the key into text from
`locales/` and sends it. Trust only ever goes up. Core Brain stores intent, response key, state and trust; never the message text.

## 1. Default public Telegram flow (works for any private sender; no extra switch)

| Step | The person says | Core Brain decides | The person gets | What we learn / store |
| --- | --- | --- | --- | --- |
| 1 | anything unclear ("hi") | intent `unknown`/`help` -> `welcome` | Welcome, "Say *scan me*", "It's free. You'll be asked for your email" | intent, state `new`; no text stored |
| 2 | "scan me", "/start", "am I exposed?" | intent `scan` -> `firstHexagon`, state `awaiting_confirmation` | The First Hexagon teaser: what the free scan looks at (device, IP, email, people-search, brokers), what the bot can see on their Telegram profile, then "Reply *Y* ... *N*" | state change, one `interaction_log` row |
| 3a | "Y" | intent `verify` -> `confirmedYes`, state `confirmed`, trust raised to 1 | "Great. You run the scan in your browser. Start here: (link). When it's done, give your email and we'll send you your report." | trust 1 (self-asserted: they typed yes) |
| 3b | "N" | `confirmedNo`, state `declined`, trust unchanged | "No problem... say *scan me* any time" | state `declined` |
| any | an email or phone number | `contactUnsupported` (no Qwen call) | "Please don't send one here. Say *scan me* and I'll send you the link" | nothing |
| any | "STOP" / "delete my data" | handled by `delete-my-data.ts` | confirmation of erasure | erases the sender's rows |

**Reading of this:** the public bot is a funnel, not a data collector. It collects consent and an intent, then sends the person to the
website scan, where the email is asked for. The bot itself learns no personal data in this flow.

## 2. Richer Telegram features (built; each is gated)

| Feature | Trigger | What the person gets | What we learn / store | Gate (default OFF unless noted) |
| --- | --- | --- | --- | --- |
| Baseline scan (MPC-7891) | "Y" at step 3a | A risk report: hexagons returned out of 30 | Snapshot in `profile_snapshots` (retention `PROFILE_SNAPSHOT_RETENTION_DAYS`) | `TELEGRAM_BASELINE_SCAN=on`, and `TELEGRAM_SCAN_SCOPE=all` or sender in the test allow-list |
| Fix wizard (MPC-7894) | `/fix` | Issues from their latest snapshot, one at a time, with a guide and "I fixed it / keep / skip / back" | self-reported fixes; re-check observations (kept separate, never one score) | `TELEGRAM_FIX_WIZARD=on` + scope as above |
| Dashboard link (MPC-7893) | "dashboard" | One-time link to their results | link hash only | `TELEGRAM_DASHBOARD_LINKS=on` + scope |
| Deep check (MPC-7892) | "DEEP", then "DEEP YES" | Check of their own @username against public profile endpoints | DEEP job and results | `TELEGRAM_DEEP_SCAN=on` + scope |
| Records check (MPC-8689) | `/listing <url> <name>` or `/archive ...` | Whether their text appears on a page they supply | nothing stored | see `records-check.ts` |
| Hexagon capture (CK-8502) | any private message | nothing extra | the Telegram profile values that message carries, one `social_events` row | `TELEGRAM_CAPTURE_HEXAGONS=on` |
| Delete my data | "STOP" / "delete my data" | Erasure of the above | erases it | always on for any sender the scan is open to |

The scope switch `TELEGRAM_SCAN_SCOPE`: unset = only allow-listed test accounts (`PROBE_TELEGRAM_IDS`); `all` = any private, non-bot sender.
Wording of these features is marked DRAFT pending the owner's approval in the code comments.

## 3. X (Twitter)

| Event | Handled by | The person gets | What we learn |
| --- | --- | --- | --- |
| A direct message | `social-listeners` itself (`mirror-bot.ts`), not Core Brain | a welcome reply; "MIRROR" -> consent -> "MIRROR YES" -> public profile scan -> educational DM; delete request supported | MIRROR keeps nothing: the scan result and text live only for one request |
| A mention, follow, like | forwarded to Core Brain (`/ingest/social`) and the CRM feed | **no reply** | logged only; X senders have no state row (always trust 0) |

## 4. Gaps against the goal "ask a lot, give something back every time"

1. **The public flow gives little back before it sends people away.** Steps 1 to 3 give a description of the scan and a link; the first real reward (the report) comes after leaving the chat and giving an email on the website.
2. **No progress, points or streaks exist.** State is only `new` -> `awaiting_confirmation` -> `confirmed`/`declined`, and trust is 0 or 1.
3. **The richer, more rewarding features (risk score, fix wizard) are behind switches** and, by default, reachable only by test accounts.
4. **X mentions get no reply**; X DMs get the MIRROR flow, which stores nothing by design (so also learns nothing).
5. **Trust is self-asserted** (typing "Y"). Nothing should be gated on it that is personal.
6. **The bot's words are fixed keys** (`locales/`), which suits a consistent game, but any new "reward" step needs new keys in every locale (10 today).

## 5. Questions for the owner before designing the game

- Which switches should be ON for the first real users (`TELEGRAM_BASELINE_SCAN`, `TELEGRAM_SCAN_SCOPE=all`, ...)? The defaults keep real people out of the richer flow.
- What is the first reward a person should get inside the chat, before any link?
- What data do we actually want from the chat (the website scan already collects the email)? Each ask should state why and be skippable; this is a privacy product.
- Do X mentions need a public reply, or is DM-only enough?
