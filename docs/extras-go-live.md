# Going live with the built extras (MPC-8689): runbook and Telegram test plan

86 extra hexagons are built and merged. **None has run on a real platform.** Every one is off by default, answers allow-listed test accounts only, stores nothing, logs counts only and is outside every score. This page says what each needs to run for the first time, and how to prove Telegram works end to end before turning on anything else.

## Rules for every channel
- Turn on **one channel at a time**, with **one test account**, and write down what you saw before starting the next.
- Allow-lists fail closed: an empty or unset list means nobody gets a result.
- "Not checked" is a valid, honest answer. A step that says "returned" for something that wasn't there is a bug: stop and report it.
- Rollback for any channel: unset its switch (or set it to anything but `on`/`1`/`true`). The migrations only add a table and columns with defaults and need no rollback.

## Where switches live (read this before setting anything)
- **Worker (`workers/social-listeners`):** plain vars set outside `wrangler.toml` are **wiped by the next deploy** (this already happened with other flags; see the comments in `wrangler.toml`). Put each `*_EXTRAS = "on"` in the `[vars]` block of `workers/social-listeners/wrangler.toml` so a deploy keeps it, or use the flags workflow and re-check after the next deploy. Secrets and allow-lists go in as Worker **secrets**, never in the file.
- **Pages:** `FOOTPRINT_HANDOFF=1` is a Pages environment variable. `VITE_WEB_EXTRAS=true` is a **build-time** variable: it only takes effect after a new build.
- **scan-report Worker:** `EMAIL_EXTRAS_ENABLED=true`.

## Per channel
| Channel | Hexagons | Route or switch | Needs | First test |
| --- | --- | --- | --- | --- |
| Telegram | 5 in the baseline report (+1 flagged) | `TELEGRAM_BASELINE_SCAN=on`, sender in `PROBE_TELEGRAM_IDS` | nothing new | see the test plan below |
| Telegram to Web handoff | link + `/api/footprint` | Worker `TELEGRAM_FOOTPRINT_LINKS=on`; Pages `FOOTPRINT_HANDOFF=1` | Supabase service key already used by `/d/` | see the test plan below |
| Web | 9 | build with `VITE_WEB_EXTRAS=true`; Worker route `/whoami-extra` (mpt-leads) | a preview build | open `/scan`, finish a scan, expand "Extra connection checks" |
| Email | 4 | scan-report `EMAIL_EXTRAS_ENABLED=true` | nothing new | run a test scan for a `+` test address; look for `extra-email.*` signal rows |
| Discord | 11 | `POST /webhook/discord`; `DISCORD_SCAN=on` | Discord application, `DISCORD_PUBLIC_KEY`, slash command registered, `DISCORD_PROBE_IDS`, optional `DISCORD_BOT_TOKEN` | run the slash command; compare the private reply with what Discord sent |
| SMS (Twilio) | 4 | `POST /webhook/sms-extras`; `SMS_EXTRAS=on` | Twilio number pointed at the route, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_URL` if behind a proxy, `SMS_PROBE_NUMBERS` | text the number from a test phone |
| Viber | 13 | `POST /webhook/viber`; `VIBER_EXTRAS=on` | Viber bot, `VIBER_AUTH_TOKEN`, webhook set, `VIBER_PROBE_IDS` | message the bot; start a conversation from a deep link |
| LINE | 5 | `POST /webhook/line`; `LINE_EXTRAS=on` | official account, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_PROBE_IDS` | message the account; the reply endpoint is the one unverified step |
| GitHub | 6 | `POST /webhook/github-extras`; `GITHUB_EXTRAS=on` | repository webhook with a secret, `GITHUB_WEBHOOK_SECRET`, `GITHUB_PROBE_LOGINS` | comment on an issue as a test login; read the delivery log |
| YouTube | 6 | `POST /youtube/check`; `YOUTUBE_EXTRAS=on` | `YOUTUBE_EXTRAS_SECRET`, `YOUTUBE_API_KEY`, `YOUTUBE_PROBE_CHANNEL_IDS` | post a comment resource with the secret header |
| KakaoTalk | 6 | `POST /webhook/kakao?k=`; `KAKAO_EXTRAS=on` | chatbot skill URL **with the secret in it**, `KAKAO_SKILL_SECRET`, `KAKAO_PROBE_IDS` | message the channel chatbot. Kakao documents no signature, so the URL is the key |
| WeChat | 7 | `/webhook/wechat`; `WECHAT_EXTRAS=on` | Official Account, `WECHAT_TOKEN`, `WECHAT_PROBE_OPENIDS`, `WECHAT_ACCESS_TOKEN` for the follow lookups | save the server URL (GET verification), then message the account. The signature rule is unconfirmed: if every request is refused, that is why |
| Zalo | 7 | `POST /webhook/zalo?k=`; `ZALO_EXTRAS=on` | OA, `ZALO_WEBHOOK_SECRET`, `ZALO_PROBE_IDS`, `ZALO_OA_ACCESS_TOKEN` for the lookups | message the OA; read the answer in Zalo's webhook log |
| QQ | 2 | `POST /webhook/qq`; `QQ_EXTRAS=on` | bot, `QQ_BOT_SECRET`, `QQ_PROBE_OPENIDS` | save the callback URL (op 13 validation), then message the bot; the result is a counts-only log line |

## Telegram end-to-end test plan (do this first)
**Before you start:** your test Telegram account's numeric id is in `PROBE_TELEGRAM_IDS`; `TELEGRAM_BASELINE_SCAN=on`; the migrations are applied (they were applied by the merge); Pages has `FOOTPRINT_HANDOFF=1` and the Worker has `TELEGRAM_FOOTPRINT_LINKS=on`. Keep every other account out.

1. **Baseline report.** Message the bot, answer the consent question with Y. Expect the existing report (the 30 hexagons, out of 30) and, new, an **"Extra checks (not part of your number)"** block and a **"Your whole footprint: N of 366 footprint hexagons checked, M still to review"** line, where N counts only the hexagons whose check ran (the disabled ones do not count). The risk number must be exactly what it was before these changes.
2. **Extras that need an action.** Send a forwarded message, a message while "away" is on, a reply to a story, and a message through an inline bot. Each time, the matching extra must move from "Not in this message" to "Seen". With none of these, "Seen" lists none of them.
3. **Handoff link.** Type `footprint`. Expect one `/f/<uuid>` link that says it shares which hexagons were checked, not your values. Open it: a page with one button and no scan. Press the button: you land on `/scan?handoff=1` with no token in the address.
4. **Web card.** Finish a web scan. The footprint line must include the Telegram part, labelled "from your Telegram scan on <date>", and the per-channel split must read like "Web scan 54 of 83, Telegram 30 of 47" (plus the extras). Before the web scan finishes it must read the Telegram count alone.
5. **Safety checks.** Open the same link a second time: "can't be used". Open `/api/footprint` in a private window: 401. Try `/api/dashboard` with the footprint session: 403. Type STOP / delete my data, reload the web card: the Telegram part is gone and `/api/footprint` answers 410 or 401.
6. **Record the result** on the "verify the extras" Notion task: screenshots of steps 1, 3 and 4, the counts you saw, and anything that differed from "expect".

**Pass:** every "expect" above happened and nothing else changed. **Stop and report:** a count that moved the risk number, a value (not just an id) in `/api/footprint`, a result for something that was not in the message, or the link working twice.

## After Telegram passes
Pick the next channel by what you have an account for, run its first test from the table, record it, and only then the next. Build nothing new until the first two channels have run for real.
