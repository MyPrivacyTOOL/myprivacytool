# MPC-9826 (F7a): Alice reply wording and channel states

Truth (ledger EXT-01, C25b and C22): a reply to an Alice email goes to the `hello@myprivacytool.io` mailbox, a person's inbox, not to Alice. Inbound triage (MPC-9783) is not built, so a conversation with Alice herself does not exist yet (F7b, planned). Decision 6 (Chris, 2026-11-07): vision wording stays, every non-live claim carries a marker. In email the marker is the plain text "(coming)".

One source for the reply wording: `shared/reply-wording.js`. The confirmation email, the report email and the FAQ all read it; `src/data/faqs.reply.test.ts` and `workers/scan-report/alice-wording.test.mjs` fail if they drift.

New reply sentence: "Reply to this email and a person on the MyPrivacyTOOL team will read it and answer, with Alice's help. A conversation with Alice herself in this thread (coming)." No reply-time promise: nothing in the repo shows the mailbox is monitored on a schedule.

Sign-off (Chris, 2026-10-10): "Alice, MyPrivacyTOOL" then "Our AI guide. This email was written with AI assistance." (`SIGN_OFF`, used by every Alice email).

## Inventory: every sentence about how to talk to MPT or Alice, or which channels exist

| Location | Sentence (before) | True today? | Fix |
|---|---|---|---|
| Confirmation email, intro | "From now on I'm your personal point of contact for your privacy concerns." | No (Alice is not a contact point yet) | "My aim is to be your personal point of contact for your privacy concerns (coming). Today I guide you through your report, and the team behind me answers your replies." |
| Confirmation email, reply paragraph | "This email is now our open channel... we'll continue the conversation right here. A real person on our team can step in whenever you ask." | Partly (a person reads replies; no conversation with Alice) | Shared reply promise (above), plus "You can reply with a question, or with the name of either hexagon below." |
| Report email, reply paragraph | "This email is our open channel. Reply anytime with a question and we will continue the conversation right here, or reply to ask us to delete your data." | Partly | Shared reply promise, plus "You can also reply to ask us to delete your data." |
| Confirmation email, sign-off | "Alice / Your Dedicated MyPrivacyTOOL AI" | Not the standing rule | "Alice, MyPrivacyTOOL / Our AI guide. This email was written with AI assistance." (all Alice emails, and the Deep Research code email) |
| Email footer (all) | "Questions, or want your data deleted? Reply to this email or write to hello@myprivacytool.io." | Yes, if hello@ is read (see finding) | Unchanged |
| FAQ "Who or what is Alice?" | "...There is no chat..." | Misleading: it read as no way to talk to anyone | Says there is no live chat with Alice on the site today, that a person answers email replies, and that a conversation with Alice is coming (Planned) |
| FAQ (new) "Can I reply to my report email?" | n/a | n/a | Same shared promise as the emails, and "We do not promise a reply time." |
| FAQ "Can I delete my scan" and the unsubscribe answer | "...or reply to your report email" | Yes (reply reaches a person) | Unchanged |
| /start channel card list | WhatsApp, Messenger, Instagram were links; "Or message us directly on any platform"; "Message us on any of these platforms" | No (stubs; /wa redirects back to /start) | Six cards driven by `CHANNEL_STATUS`; non-live cards are not links; copy says which work today |
| /contact | "Send us a message and we'll get back to you by email." | Unverified: no repo evidence the mailbox is monitored | Unchanged here; recorded in the finding and task |
| Site footer | No sentence about channels | n/a | Unchanged |

## Channel states (`CHANNEL_STATUS` in `src/config/featureStatus.ts`)

Web: live. Telegram: live (2026-11-08, MPC-9850). Email: live. WhatsApp: planned. Messenger: planned. Instagram: planned.

Telegram stays "In build": the build session had no outbound route to api.telegram.org or the Worker, so no synthetic message could be round-tripped. The bot, webhook and reply path are built and unit-tested (`workers/social-listeners`). Flip one line when a live round-trip is recorded.

## Reply-to finding

`sendEmail()` sets `reply_to` from `EMAIL_REPLY_TO`, which is set in no wrangler file, no secret list and no doc. Replies therefore go to the From address, `hello@myprivacytool.io`. Nothing in the repo shows that mailbox is monitored (only `support@` is confirmed to arrive in a Gmail inbox, 2026-10-11). Not changed here: the reply path is not plainly broken, only unverified. A follow-up task checks it.

Reply-to: hello@ → monitored (Chris, 2026-11-08). hello@myprivacytool.io forwards to his personal Gmail, which he reads (MPC-9849). Reply-to is no longer unverified; no routing change needed. F7a stays in_build until MPC-9850 (Telegram round-trip) is Done.

Update 2026-11-08 (MPC-9850 / CK-9912): Telegram round-trip recorded (workflow run 42474106577: message in 11:04:30.98Z, reply out 11:04:37.51Z, 8080 ms from send, Telegram answered ok). Every sentence in the inventory above was re-checked against the code and Chris's hello@ confirmation: all true. CHANNEL_STATUS.telegram and F7a are `live`; the /start footnote now reads "Web, Email and Telegram work today".
