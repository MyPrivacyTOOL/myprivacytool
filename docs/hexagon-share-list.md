# Share list: the highest-risk hexagons that arrive on first contact (DRAFT for review)

**Status: draft. Nothing here has been posted.** Each line links the live page `/hexagon/<name>/` for a High-risk, class A hexagon (the fact arrives with the person's first message, request or event). 26 hexagons meet that rule; these are the 14 that read best and say something true without needing a scan. Rules for every post:
- Say what a channel **can** reveal. Never say MPT found it or checked it unless the hexagon is marked "MPT checks this" below.
- Do not use red, "danger" or fear wording that the page itself does not support. The page explains the risk, what it can be used for and what to do.
- The "what it could be used for" text on every page is generated general guidance. **Read the page before posting its link.**
- Left out on purpose: `dns-leak` (its own description says it is a second WebRTC probe, so a post would mislead), `if-they-email-us-sending-servers` and `commit-name-and-email` (marked Verify, not confirmed), and the three Telegram rows whose page text is a generated sentence.

Base link: `https://www.myprivacytool.io/hexagon/<slug>/`

| # | Slug | MPT checks this | Draft post (about 250 characters) |
| --- | --- | --- | --- |
| 1 | `webrtc-leak` | yes (web scan) | Using a VPN? Your browser can still show a website your real internet address through WebRTC. See what that reveals and how to close it: /hexagon/webrtc-leak/ |
| 2 | `name-in-your-address` | yes (email report) | Your email address may already say who you are: a first name, an initial, even a birth year before the @. Here's how that gets used, and what to do: /hexagon/name-in-your-address/ |
| 3 | `at-username` | yes (Telegram bot) | Message a Telegram bot and it receives your name and @username automatically. If you use the same handle elsewhere, that links your accounts. What to do: /hexagon/at-username/ |
| 4 | `sms-phone-number` | not yet | Every text you send gives the receiver your full phone number. Many sites also use it as a login. What a number can be used for: /hexagon/sms-phone-number/ |
| 5 | `phone-number-whatsapp-id` | not yet | Message a business on WhatsApp and it can see your phone number (unless you use a username). What that allows, and how to limit it: /hexagon/phone-number-whatsapp-id/ |
| 6 | `profile-name` | not yet | The name on your WhatsApp profile goes to every business you message. Is it your real name? What it can reveal: /hexagon/profile-name/ |
| 7 | `username-and-display-name` | not yet | Run a Discord app's command and the app gets your username and display name. Same name on other sites? Why that matters: /hexagon/username-and-display-name/ |
| 8 | `viber-name-and-photo` | not yet | A Viber bot sees your name and photo the moment you message it. Why a photo is easy to match to a real identity: /hexagon/viber-name-and-photo/ |
| 9 | `if-they-email-us-signature-block` | not yet | Email a company and your signature block hands over your job title, company and phone number. Why that is useful to a scammer: /hexagon/if-they-email-us-signature-block/ |
| 10 | `caller-number` | not yet | Phone a business and your number reaches them unless you withhold it. What a caller number can be matched to: /hexagon/caller-number/ |
| 11 | `voice` | not yet | Your voice carries your accent and background noise, and it is a biometric if it is recorded. What that can be used for: /hexagon/voice/ |
| 12 | `header-line` | not yet | Every fax page prints your name, number, date and time across the top. Still sending faxes? What that tells the receiver: /hexagon/header-line/ |
| 13 | `return-address` | not yet | A return address on an envelope tells whoever opens it your name and where you live or work. What that is used for: /hexagon/return-address/ |
| 14 | `voice-recording` | not yet | Send a voice note on WeChat and the account behind it gets your voice. Why a recording is more than words: /hexagon/voice-recording/ |

## Before posting
- [ ] Open each linked page and check the claim in the post matches the page.
- [ ] Rows marked "not yet": confirm the wording does not imply MPT scans that channel (the page itself says "Not checked by MPT yet").
- [ ] Decide the order: rows 1 to 3 are the ones MPT can really check today, so they make the safest first posts.
- [ ] Owner decisions that affect the posts: the risk colours on the pages, and whether WhatsApp (rows 5 and 6) belongs in the model.

## Final copy for the first three posts (owner decision 8, 2026-10-29): ready for your read, NOT posted
Each post uses only what the linked page says, and the pages for these three are the hand-written, "Text reviewed 2026-10-29" ones (PR #662). **Do not post until #662 is merged and deployed**, otherwise the link still shows the older generated text. Check each link opens before posting.

### 1. `webrtc-leak` (MPT checks this in the web scan)
- **Short (about 230 characters):** Using a VPN? Your browser can still hand a website the real internet address your VPN is meant to hide, through WebRTC. See what that reveals, and how to test and close it: https://www.myprivacytool.io/hexagon/webrtc-leak/
- **Longer:** A VPN is meant to hide your real internet address. A browser feature called WebRTC can show it to a website anyway. That address points to your internet provider and roughly your city, and trackers can use it to recognise you across visits. Here is what it reveals and how to test your VPN for leaks: https://www.myprivacytool.io/hexagon/webrtc-leak/

### 2. `name-in-your-address` (MPT checks this in the email report)
- **Short (about 240 characters):** Your email address may already say who you are: a first name, an initial, even a birth year before the @. That makes scam emails feel personal and helps link your accounts. How it gets used, and what to do instead: https://www.myprivacytool.io/hexagon/name-in-your-address/
- **Longer:** Anyone who gets your email address can guess a first name, an initial or an age from the part before the @. A guessed name makes a phishing message feel personal, and the same name or number in other usernames helps link your accounts. Use a separate address with no name for sign-ups. More: https://www.myprivacytool.io/hexagon/name-in-your-address/

### 3. `at-username` (MPT checks this in the Telegram bot)
- **Short (about 235 characters):** Message a Telegram bot and it receives your first name, last name and @username with your first message, without you sharing anything. What a handle gives away, and how to limit it: https://www.myprivacytool.io/hexagon/at-username/
- **Longer:** When you message a Telegram bot, it gets your first name, last name and @username (if you set one) automatically. Searching the same handle on other sites can link your accounts, and a name plus a handle is enough to start a convincing impersonation. Use a handle you use nowhere else: https://www.myprivacytool.io/hexagon/at-username/

### Before each post
- [ ] You have read the linked page, not only the post.
- [ ] The post does not say MPT found anything about the reader. It says what the channel can reveal.
- [ ] #662 is merged and the page shows the "Text reviewed 2026-10-29" tag.
