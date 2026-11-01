# Privacy and terms wording for the 19-or-over rule and Telegram capture (MPC-9014)

Status: **DRAFT for owner approval. Nothing here is live.** Every claim below cites the code or database it comes from. Where the live pages disagree with the code, that is listed first because it changes what can be promised.

## 1. Conflicts found (decide these before any wording is approved)

| # | What the live page says | What the code or database does | Source |
|---|---|---|---|
| A | Privacy 2.1 "Messaging Channel Data": kept "for up to 90 days, then deleted automatically". | Captured Telegram rows (name, @username, language, message text) sit on a contact row with `retain_until = now() + 2 years`. The purge function `mpt_purge_expired_social_contacts()` exists but **no job calls it**: pg_cron is installed, 0 jobs match, and the one Telegram contact has `retain_until` 2028-10-29 (checked 2026-10-31, read-only). So the promise of 90 days is not kept. | `supabase/migrations/20261028110000_ck_8502_social_event_hexagon_data.sql` line 56; `20261013140000_mpc_7628_social_activity.sql`; live query |
| B | Privacy "Age Confirmation": 16 or older, checkbox. Terms: at least 16. | The Telegram bot now says 19 or over and asks for Y. | `src/pages/Privacy.tsx`, `src/pages/Terms.tsx`; `locales/en/main.json` `bot.first_hexagon.age` |
| C | HMAC (when set) is described as keeping the real Telegram id out of the database. | Hashing covers the scan tables and the capture key only. `conversation_states` (core-brain) keeps the **plain** id by design, and so do Telegram API calls. The hashed key also does not hide username, name, bio or message text. | `workers/social-listeners/src/sender-key.ts` header |
| D | Core Brain docs say it stores no message text. | True for core-brain. The capture path stores `tg.message_text` (what the person writes) in `social_events` data once the sender has confirmed with Y. | `workers/social-listeners/src/telegram-capture.ts` `telegramRecord` |

Recommendations: A: make the code match the policy (90 days for Telegram capture, and schedule the purge); B: keep the website at 16 and state the Telegram bot is 19 or over, or move both to 19 if you want one rule; C: do not claim the raw id is not stored until conversation_states is covered; D: keep the policy sentence that message text is kept (it already says so) and make the in-chat sentence say so too (it does).

## 2. Facts table (what is true in the code today)

| Fact | Where |
|---|---|
| The teaser says "MyPrivacyTOOL is for people aged 19 or over." and asks the person to reply Y only if they are 19 or over. | `locales/en/main.json` (`bot.first_hexagon.age`, `reply_y`) |
| Age is a self-declaration. Nothing verifies it. | design, `docs/core-brain-game-flow.md` section 9 |
| Nothing is captured before Y. A missing row, any other state or a failed lookup means nothing is recorded. The Y message itself is not recorded. | `telegram-capture.ts` `consentConfirmed`, `captureTelegram` |
| Capture records, per message: first name, last name, @username, language, message time, message text, update counter. | `telegram-capture.ts` `telegramRecord` |
| The in-chat disclosure is added only to replies after Y: "To reply, I keep the details Telegram sends me with your messages (your name, @username, language and what you write). Send STOP any time and I'll delete them." | `reply.ts` `CAPTURE_DISCLOSURE` |
| STOP or "delete my data" erases the capture (under the hashed key and the plain id) and the conversation row. | `telegram-capture.ts` `eraseTelegramCapture` |
| Scan snapshots, deeper-scan results: 90 days by default (configurable 1 to 365). | `baseline-scan.ts`, `deep-scan.ts`, `event-extras.ts` |
| Capture and conversation state: no automatic expiry in practice (see conflict A). | live query, migrations |

## 3. Proposed wording (English; replaces or adds to the live text only after approval)

**Privacy, "Age Confirmation" (replace):**
> We ask you to confirm your age. On our website you confirm you are 16 or older with a checkbox. Our Telegram bot is for people aged 19 or over: it asks you to reply Y only if you are, and it records nothing from your messages before you do. We cannot check your age, so this relies on your answer. We do not collect or store your date of birth.

**Privacy, "Messaging Channel Data" (add after "…not shared publicly."):**
> On Telegram we start keeping these details only after you reply Y. Until then we keep nothing from your messages beyond the stage of the conversation. After you reply Y, the bot tells you in the chat what it keeps. [Retention sentence: choose after conflict A is decided: "We keep it for up to 90 days, then it is deleted automatically."]

**Terms, eligibility (add):**
> Our Telegram bot is for people aged 19 or over. By replying Y you confirm that you are.

## 4. Not claimed on purpose
- That age is verified. It is not.
- That the raw Telegram id is never stored (conflict C).
- That deletion is complete everywhere: Telegram's own copy is outside our control (already stated in the live page).

## 5. Approval
Owner approves, or edits, the wording in section 3 and decides A and B. Until then the PR stays a draft and nothing ships.
