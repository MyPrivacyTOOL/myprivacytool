# The magic guess: "Is this your main email?" (MPC-11111)

Status: BUILT AND TESTED, SWITCHED OFF. Chris decided on 2026-11-24 to build it ("YES lets build it"). Nothing in production changes until the gates below are opened.
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

## The three gates (all needed; any one missing = off)

| Gate | Where | Who |
|---|---|---|
| `EMAIL_GUESS_ENABLED = "true"` | wrangler.toml of scan-report AND social-listeners (ships `"false"`) | a PR, after the copy is approved |
| `EMAIL_GUESS_KEY` Worker secret, the same value on both Workers | `wrangler secret put` | Chris only |
| `VITE_EMAIL_GUESS_ENABLED=true` | Cloudflare Pages build variable | Chris |

Rollback: set `EMAIL_GUESS_ENABLED = "false"` and deploy. Tokens already sent stop opening and the card disappears.

## DRAFT wording that needs Chris's approval before the switch is turned on

1. DM notice (`GUESS_NOTICE` in workers/social-listeners/src/mirror-bot.ts): "I noticed an email address in your public bio. When you open the link, I'll offer it back to you for the scan so you don't have to type it. I don't store it."
2. Card (src/components/EmailGuessCard.tsx): "Is this your main email?" / "Your public X bio lists {address}. This is only a guess, and we have not stored it." / "Yes, use this one" / "No, I will type another".
3. The Mirror consent message says what is read (bio, location, link, join date, counts). Reading an address out of the bio is within "bio", but the owner may want one more clause there.
4. Privacy page: nothing new leaves our systems and nothing new is stored, so no new recipient or retention entry is needed; confirm with the privacy owner.

## Not built, on purpose (recommendations)

- **Telegram.** A Telegram profile carries no email, and reading a Telegram bio needs a `getChat` call the consent text does not mention. Recommended: leave it out until the owner wants it and the wording changes.
- **A single-use token.** That would need a store of used tokens, which is a new personal-data store (CK-8502 constraint). The 24 hour expiry and fragment placement are the substitute.
- **Guessing from the web visit alone** (cookies, device) or from other platforms. That is identity matching.

## Tests

`shared/email-guess.vitest.ts` (finder and token), `workers/scan-report/email-guess.test.mjs` (endpoint), `workers/social-listeners/mirror-bot.vitest.ts` (the Mirror link), `src/pages/ScanEmailGuess.test.tsx` (the page).
