# MPC-9894 hand-off: registry-generated legal blocks, and what is left for MPC-9907 (pass 2) and the translations (MPC-10618)

Written 2026-11-15 against `main` at e4bee903 plus this PR. Design: Open Tracker Design & Build Plan (v1), sections 1.6 and 5.

## What is generated now (nothing in these places is typed by hand)

`scripts/render-privacy-from-registry.mjs` (run by hand) calls `shared/recipients/legal-blocks.ts`, which calls `renderDisclosure` for every live entry in
`shared/recipients/recipients.json` and writes `src/data/legalBlocks.generated.json` (all ten locales). Components in `src/components/LegalRecipients.tsx` render it.

| Where | Generated block |
| --- | --- |
| Privacy section 5 | every live recipient, grouped (run by us / processors / platforms / other outside services), plus "planned and not yet open" (Stripe) and "no longer used" (Google Fonts) |
| Privacy 2.3 | the one-sentence visit-log disclosure (design 3.5), raw-IP window read from the `visit-log` entry |
| Cookies 2.2 | the outside services the browser itself contacts (registry `surface: browser`, not first party) |
| DPA section 4 | the sub-processor rows: live, not first party, `dpa_listed: true` |

Hand-written, but about our own handling and not about a recipient: Privacy 2.3 country policy and bot record, 5A consent text frame, 6 retention bullets, 6A retention by relationship.
The consent text itself is `shared/recipients/consent-text.ts` (wording A, version 2026-11-v1), rendered verbatim.

Test `src/data/legalBlocks.test.tsx` fails when: the generated file is stale; a page omits a live recipient or lists one the registry lacks; a registry host or a provider name is
typed in Privacy, Cookies, DPA or the FAQ outside the generated blocks; a host-shaped string in the rendered pages is not a registry host; the old false sentences
("not a tracker", "no separate service sees your IP", ipify, ipapi.co) come back anywhere under `src/`.

## Registry text corrected in this PR (it feeds /what-we-see too)

Internal ticket numbers and environment-variable names had leaked into purposes and retention text (hunter, stripe, meta-graph, anthropic, youtube-data-api): reworded. `pwned-passwords` now declares `ip` and
`user_agent` (the browser call to the provider exposes them; the old Privacy sentence said so) and is named "Have I Been Pwned (password check)". `dashscope` carries the "any provider, open or closed source, any country" wording the DPA row
had. `user-pasted-listing` has its own English sentence. `recipients.data.js` re-emitted.

## Left for MPC-9907 (pass 2): hand-written legal sentences still to check, by place

True/false/future-as-present marking is MPC-9907's job. These are the sentences I did not change and could not verify from here.

English, site:
- `src/pages/HongKongSpam.tsx` and `src/data/hkSpamCopy.ts`: `HK_POLICY_EN` and `HK_POLICY_ZH` (zh-HK, title "15. 香港拒收垃圾訊息頁面"): 15.3 "90 days after your protection date", the "privacy tips" exception, and every storage and analytics sentence in 15.1 to 15.2. Not touched.
- `/thank-you` (`src/pages/ThankYou.tsx:135`) storage sentence versus the homepage sentence (`src/pages/Index.tsx:456`): they differ (MPC-9907 requirement 1, word for word).
- Privacy 2.0 "What Stays in Your Browser" ("The finished result stays in your browser. It is not sent to us unless you ask..."): check against the consent flow, because pressing Scan me now sends lookups to our Workers.
- Privacy 2.4 and 2.4A, 3 (how we use), 4 (legal basis), 7 to 14: not reviewed for recipient or retention facts.
- FAQ: "Does the scan send my results to your servers?" and "How can I check the scan stays in my browser?" (same concern as 2.0).
- Components that claim local-only: `FinalSummaryPanel.tsx` (lines ~677, 1060, 1062 "100% Local", "Nothing is transmitted"; pinned by `FinalSummaryPanel.tile.test.tsx`), `locale/PrivacyBanner.tsx` (20, 36 "No data is sent to any server", "No data storage"), `LanguageIntelligencePanel.tsx:580`, `SecurityPanel.tsx:571`, `VoiceDebugPanel.tsx:1263`, `FederatedLearningModal.tsx` (207, 257).

Per locale (ja, zh, ko, vi, es, de, fr, pt, ar):
- `locales/<l>/main.json`: only `bot.first_hexagon.location` and `bot.first_hexagon.question` mention what we can see (Telegram profile, IP address). No Privacy, retention or recipient sentence exists in `locales/`. The 10-locale consent text is in `consent-text.ts` (working translations; native review via MPC-6798).
- The generated blocks for these nine locales are English with a "translation pending" note (`TRANSLATION_PENDING_NOTE`). Translating them is MPC-10618.
- `/what-we-see` column headings and data-item names are already translated by MPC-9893; its one-line reasons are English.
- Not swept (no search hit, not in `src` or `locales`): worker-side message copy (Telegram bot and email templates under `workers/`) and the blog (`src/data/blogPosts.json`). MPC-9907 must sweep them.

"Not a tracker" sweep (non-test, `main`): found and replaced in `src/data/faqs.ts` (question is now "What does \"Open Tracker\" mean?"), `src/components/WelcomeBack.tsx` (comment),
`workers/scan-report/lib/recognise.js` (comment), `docs/open-mirror-mpc-7494.md`, `docs/broker-lookup-contract-mpc-9812.md`. None in the header, footer, About, `pageMeta.json`, `index.html` or `locales/`. Social bios and videos are outside the repo.

## For MPC-9904 (paid breach check)

Privacy states "We do not currently check whether your email address appears in data breaches" (hand-written, pinned by a test), and `hibp` and `xposedornot` are `enabled: false` in the registry. When the paid source is
switched on: set the entry live, add it to the registry with `dpa_listed: true`, delete that Privacy sentence, and the generated list and DPA follow. Nothing else on the legal pages needs a hand edit.

## Things only Chris can decide

1. DPA scope. The DPA table is now exactly the registry's `dpa_listed` third parties. Telegram (a platform) and GitHub, Hunter, Gravatar, RDAP and Cloudflare DNS (`dpa_listed: false`) are no longer rows; the design page asked for several to be added. Set `dpa_listed` true on any that should be rows. Counted as NEEDS CHRIS: 1.
