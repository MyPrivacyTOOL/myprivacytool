# The magic guess: "Is this your main email?" (MPC-11111)

Status: BUILT, TESTED AND DEPLOYED. The registry entries and the Worker switches were turned ON by PR 909 (released by Chris on 2026-11-27); to switch everything off again, revert PR 909 and delete the Pages variable. Before PR 909 the feature was SWITCHED OFF.
Chris decided on 2026-11-24 to build it ("YES lets build it"). Even with PR 909 merged nothing is sent or shown until the secrets (EMAIL_GUESS_KEY, GA4_API_SECRET) and the site variable (VITE_EMAIL_GUESS_ENABLED, then a site rebuild) are also set, which only Chris does; keep them uncreated until the DebugView run is booked. Steps: the Runbook on the MPC-11112 Notion page.
Source of the idea: Notion "Channel OSINT Workflow Strategy", Step 3 ("The Web Transition and the Magic Guess"). Rule from that page, kept: below 80 percent confidence, do not guess;
the page asks for the email as it always did.

## What the person sees

1. They send MIRROR to @MyPrivacyTOOL on X and say yes. The Mirror reads their public profile (bio, location, link, counts), as before.
2. If, and only if, their own public bio contains exactly one email address, the Mirror DM adds one DRAFT sentence ("I noticed an email address in your public bio...") and its
   link goes straight to `/scan` (same `utm_source=x&utm_medium=channel_osint&utm_campaign=bot_reply` tags as the `/x` short link) with a sealed token after a `#`.
3. On `/scan` a card asks "Is this your main email?" and shows that address. **Yes** only fills the email box. **No** leaves it empty. The consent line, the button press, the
   Turnstile check and the click-to-confirm email all still apply, so tapping Yes sends and scans nothing.
4. In every other case (no address in the bio, two different addresses, switch off, token expired) nothing changes: the page is exactly what it is today.

## Where a guess may come from (and where it may not)

| Source | Confidence | Used? |
|---|---|---|
| Exactly one valid address written in the person's own public X bio | 0.90 (they published it) | Yes, the only source |
| Two or more different addresses in the bio | ambiguous | No guess |
| Derived from a name or handle (first.last@gmail.com) | well under 0.80, a blind guess | Never |
| Another account, a data broker, a breach list, a search | identity matching | Never (docs/channel-capture-ck-8502.md) |

Expect it to fire rarely: most X bios hold no address. That is the honest result of "never guess blindly"; the existing email box is the normal path and stays so.

## How the address travels, and what is stored

- `shared/email-guess.ts` seals `{address, channel, confidence, basis, expiry}` with AES-256-GCM. The key is derived (HKDF) from the Worker secret `EMAIL_GUESS_KEY`. The token is
  random per DM, expires after 24 hours, and does not contain the address in any readable form.
- The token sits in the URL **fragment**. Browsers never send a fragment to a server, so it is not in Cloudflare logs or GA4 `page_location`. `/scan` removes it from the address bar
  on first read.
- `POST /api/scan/guess` (scan-report) opens it and returns the address to that page only. It stores nothing, logs neither the address nor the token, answers `Cache-Control: no-store`, is
  rate limited, checks the site origin, and gives the same quiet `{ guess: null }` for any token that does not open.
- Nothing is written to Supabase, KV or Notion. The address exists only inside the token, then in the page's memory for that visit.
- The address is already public (it is in their bio, and the Mirror DM already prints the bio). The token only avoids asking them to retype it.

## Analytics (GA4)

`email_guess_shown` and `magic_guess_submitted` (`answer` yes or no). Both carry `basis: bio_email` and `source: scan_page`, never the address, and are sent only for a visitor who
accepted analytics. `magic_guess_submitted` is stage 3 of the MPC-11111 flow check. The bridge click is already measurable as a GA4 session with medium `channel_osint`.

Stage 1 (`dm_received`) is sent server-side. core-brain sends it for the channels it handles, but the X bot answers its own DMs inside `workers/social-listeners` (`src/x-webhook.ts`) and never
passes them to core-brain, so that Worker sends `dm_received` (channel `x`, nothing else: no sender id, no text) once per X DM it answers; a DM it forwards to core-brain is counted there, never twice.
It needs `GA4_SERVER_EVENTS_ENABLED` exactly `true`, the `GA4_API_SECRET` secret and the registry entry `ga4-measurement-protocol` enabled on social-listeners too, and sends nothing otherwise.
(Found 2026-11-26 while writing the DebugView runbook; until then an X run would have shown no event for stage 1.)

## The four gates (all needed; any one missing = off)

| Gate | Where | Who |
|---|---|---|
| Registry entry `email-guess-service` set to `enabled: true` | `shared/recipients/recipients.json` (ships `false`), then `npm run recipients:module` and `npm run legal-blocks` | a PR, with the privacy owner's sign-off (rule 7) |
| `EMAIL_GUESS_ENABLED = "true"` | wrangler.toml of scan-report AND social-listeners (ships `"false"`) | a PR, after the copy is approved |
| `EMAIL_GUESS_KEY` Worker secret, the same value on both Workers | `wrangler secret put` | Chris only |
| `VITE_EMAIL_GUESS_ENABLED=true` | Cloudflare Pages build variable | Chris |

Rollback: set `EMAIL_GUESS_ENABLED = "false"` and deploy. Tokens already sent stop opening and the card disappears.

## DRAFT wording that needs Chris's approval before the switch is turned on

1. DM notice (`GUESS_NOTICE` in workers/social-listeners/src/mirror-bot.ts): "I noticed an email address in your public bio. When you open the link, I'll offer it back to you for the scan so you don't have to type it. I don't store it."
2. Card (src/components/EmailGuessCard.tsx): "Is this your main email?" / "Your public X bio lists {address}. This is only a guess, and we have not stored it." / "Yes, use this one" / "No, I will type another".
3. The Mirror consent message says what is read (bio, location, link, join date, counts). Reading an address out of the bio is within "bio", but the owner may want one more clause there.
4. Registry and Privacy page. Nothing new leaves our systems and nothing new is stored, but the browser call to our own Worker happens BEFORE the visitor's scan consent click, so it needs its own first-party `pre_click` entry (`email-guess-service`, ships disabled). When that entry is enabled it is listed on /what-we-see and in the generated privacy blocks, so the privacy owner must approve it first. (An earlier version of this doc said no registry entry was needed. That was wrong; see the rehearsal below.)

## Not built, on purpose (recommendations)

- **Telegram.** A Telegram profile carries no email, and reading a Telegram bio needs a `getChat` call the consent text does not mention. Recommended: leave it out until the owner wants it and the wording changes.
- **A single-use token.** That would need a store of used tokens, which is a new personal-data store (CK-8502 constraint). The 24 hour expiry and fragment placement are the substitute.
- **Guessing from the web visit alone** (cookies, device) or from other platforms. That is identity matching.

## Local rehearsal, 2026-11-26 (synthetic data, nothing in production touched)

A real Chromium was driven through the whole chain on a local production build with the switch on: the real Mirror code built the DM from a fake X profile, the real scan-report Worker ran locally with a throwaway key, and the page opened the sealed link. It found two real defects, both fixed in the follow-up PR:
1. The registry wrapper refused the page's call to the Worker with `CONSENT_REQUIRED` (the `scan-report` entry is `post_click`; a bridge-link visitor has not clicked yet). As first merged, the card could never have appeared on the live site. Unit tests missed it because they stubbed that rule. Fix: the dedicated `email-guess-service` pre_click entry above.
2. On a 390px phone the card sat two screens below the top of the page. It now scrolls itself into view once (instant if the visitor prefers reduced motion).
Result after the fixes: 19 of 19 checks pass (sealed link in the DM, no readable address in the link, card shown and on screen, token removed from the address bar, Worker asked once with the token in the body, Yes fills the box and sends nothing, No leaves it empty, damaged token and no token show no card, GA4 events queued without the address, desktop width). This is NOT GA4 DebugView evidence and NOT a real X account: those still need a person (MPC-11111 steps 4 and 5).

## Tests

`shared/email-guess.vitest.ts` (finder and token), `workers/scan-report/email-guess.test.mjs` (endpoint), `workers/social-listeners/mirror-bot.vitest.ts` (the Mirror link), `src/pages/ScanEmailGuess.test.tsx` (the page).
