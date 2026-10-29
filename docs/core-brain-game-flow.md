# Core Brain game flow (PROPOSAL, DRAFT wording, needs owner approval)

Status: **proposal only**. This PR changes no behaviour. It builds on `docs/core-brain-conversation-flow.md` (what exists today) and the
owner's decisions of 2026-10-29: give something back for every ask, one ask per message, staged switches, no email or phone in chat.
All copy below is DRAFT and uses the existing rule that nothing is shown that was not checked. Levels 0 to 3 need **no new code**;
the progress lines in section 4 do.

## 1. Rules of the game

1. **Give before you ask.** The first number comes before any link or request.
2. **One ask per message,** and every ask can be skipped ("Skip for now" already exists in the wizard).
3. **Only verified changes move the score.** The code keeps four things separate and never merges them into one score: the baseline
   (never overwritten), the user's intention, the self-report ("I fixed it"), and the re-check observation. The game must not blur them.
   Show "verified by the bot's re-check" and "you say you did it" as different lines.
4. **Be honest about what the score means.** It counts how many of 30 pieces of information Telegram sent to *this bot*. It is not a
   check of the person's privacy settings and does not show who else can see anything. Say so in the same message.
5. **No pressure.** No countdowns, no streak shaming, no loss framing, no "friends already did this". A person can say STOP or
   "delete my data" at any time and that always works.
6. **No email or phone in chat.** The bot already refuses them. The email stays on the website, where the report is delivered.

## 2. Levels (built from existing pieces)

| Level | Name (draft) | Trigger | The person gets | We learn / store | Needs |
| --- | --- | --- | --- | --- | --- |
| 0 | Hello | any first message | Welcome, "say *scan me*" | intent, state `new` | default flow (on) |
| 1 | Consent | "scan me", then **Y** | the First Hexagon teaser, says what the bot can see | state `confirmed`, trust 1 | default flow (on) |
| 2 | First number | right after Y | the risk report: "X / 30 - Low/Medium/High", what it means, what was and was not checked | one snapshot (`profile_snapshots`) | `TELEGRAM_BASELINE_SCAN=on` + scope |
| 3 | First fix | "/fix", pick an item | a one-question guide, then 3 to 4 steps; "I fixed it" triggers a re-check for the 4 checkable items (Username, Bio, Birthday, Profile photo) | verified change (or none); self-report for the 5 settings the bot cannot see (Phone number, Last seen, Forwarded messages, Groups, Auto-download) | `TELEGRAM_FIX_WIZARD=on` + scope |
| 4 | Whole picture | after a first verified fix | "Telegram is one channel of N. Check the web side too" + the website scan link | email asked **on the website only** | `TELEGRAM_BASELINE_SCAN` (footprint line exists) |
| 5 | Keep going | "/fix" again, "dashboard" | remaining items; a one-time dashboard link | fix-list progress, link hash only | `TELEGRAM_DASHBOARD_LINKS=on` + scope |

"People Nearby" is listed in the guides but marked unavailable (could not be verified), so it is not offered.

## 3. How "points" work (without breaking rule 3)

- **Score = the existing risk count** ("X / 30"). A verified fix lowers it by the items the re-check no longer sees returned.
- **Badges (draft)** are shown, not scored: *First number* (level 2), *First verified fix* (level 3), *Four checkable items done*, *Web side checked*.
- Self-reported items earn **no points and no badge**; the list shows them as "you say you did it".

## 4. New copy (DRAFT, English; each needs a key in every locale, 10 today)

| When | Draft text |
| --- | --- |
| After the report (level 2) | "That is your first number. Want to bring it down? Send /fix. One small step at a time, and you can stop any time." |
| After a **verified** change | "Level up. Your Bio is no longer returned to this bot: X / 30 down to Y / 30. This is what the bot receives; it does not show who else can see it. Next: Birthday, about one minute. Send /fix, or stop here." |
| After a self-reported fix | "Noted: you say you changed Last seen. I cannot check this one, so it does not change your number." |
| After all 4 checkable items | "You have done everything this bot can check. Telegram is one channel of N: to look at the web side too, here is the free scan: (link)." |
| Re-check failed | existing wording ("I could not re-check just now... Nothing was changed or scored.") |

Implementation sketch for a later PR (not in this one): a small `progressLine()` in `fix-wizard.ts` that appends "N of 4 checkable items verified"
to the fix list, plus the copy keys above. Tests must cover: self-report never changes the number; a failed re-check never shows a level-up.

## 5. What we ask for, and why

| Ask | Why it is asked | Skippable | Stored |
| --- | --- | --- | --- |
| Y to the teaser | consent to read the public Telegram profile details | yes (N) | consent state |
| Pick a fix item | decides which guide to show | yes | choice (the answer only changes the advice) |
| "I fixed it" | triggers the re-check | yes | the observation, kept apart from the self-report |

Nothing else is asked in chat. A "what worries you most" question was recommended as optional; it is **not** in this proposal until the owner wants it.

## 6. How we will know it works (from existing data, no message text)

Funnel from `interaction_log` and the wizard tables: first message -> Y -> first number -> first fix opened -> first verified fix ->
website scan started. Watch where people stop. Also watch the share of answers that fell back to rules (`intent_source`), p99 latency of the quick path,
and STOP / delete requests (a rise means the tone is wrong).

## 7. Rehearsal script (needs the owner's Telegram id on `PROBE_TELEGRAM_IDS`)

1. Send "hi" -> expect the welcome. 2. "scan me" -> teaser with Y/N. 3. "Y" -> link reply, then the risk report (if baseline is on for you).
4. "/fix" -> list of items. 5. Pick Bio, answer the question, change your bio, tap "I fixed it" -> expect VERIFIED or "no change observed".
6. Pick "Last seen" -> expect "cannot check" wording. 7. "dashboard" -> one link. 8. "delete my data" -> erasure confirmation, then "/fix" should say there is nothing.
Record each reply next to the expected one. Do not open the scope to everyone until all eight match.

## 8. Open questions for the owner

- Approve the level names and badge names (section 2, 3)? They are placeholders.
- Telegram has users under 18. Do we need an age line before the first ask? (Privacy/legal check needed; not decided here.)
- Do you want the optional "what worries you most" question?
- Who approves the DRAFT report and guide wording before `TELEGRAM_SCAN_SCOPE=all`? (The code marks it pending the owner's approval.)
