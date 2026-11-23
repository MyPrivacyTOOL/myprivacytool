# MPC-9806 (EXT-19): geography and source coverage before data collection

Checked 2026-11-18 against main HEAD 136b24b and the live site.

## (1) What the listing check supports (COVERAGE-001)

Code: workers/scan-report/lib/brokers.js, listingCheck.js; docs/broker-lookup-contract-mpc-9812.md, docs/f1-live-check-mpc-9813.md.

- **No broker is searched automatically.** The five `BROKERS` (Spokeo, Whitepages, BeenVerified, MyLife, Intelius) are all reported "not yet checked" with an opt-out guide: they search by name and place, forbid automated scraping and sit behind bot protection (brokers.js 3-10).
- **What is checked is a page the visitor pastes.** Any site is read; nine are recognised by domain (`BROKER_SITES`): Spokeo, Whitepages, BeenVerified, TruthFinder, FastPeopleSearch, MyLife, Intelius (all US), White Pages Australia (`whitepages.com.au`), and Truecaller (`fetchable: false`: it needs a sign-in, so a pasted address is reported not_checked with its guide).
- **Result states:** `listed` (exact, probable, possible; possible is a guess), `not_listed` (page gone, or the details are absent from the page), `not_checked` (blocked, timeout, no identifiers, not a listing page; never reported as not_listed) (listingCheck.js 8-12).
- **Regions:** United States (seven sites), Australia (one). Hong Kong and Singapore have no recognised site in `BROKER_SITES`, and the panel says nothing about them (MPC-10827: pilot-region wording dropped until sources exist).

Live pages before this change: /start already said "We don't search broker sites for you yet - paste any page that lists you and we'll verify it." /scan, /business, /pricing and /faq said nothing about what the check covers; /scan and /business say "data brokers ... list your name, address and phone number" without a region. /business step 02 still says "we check data brokers for each team member" (tagged "In build").

## (2) Coverage statement before collection (UX-033, SCORE-009)

Added to /scan (above the email form) and /start (under the intro, before any field): what the check covers, that no broker is searched, the nine recognised sites by region, and that "not listed" is not clearance (`src/components/ListingCoverageNote.tsx`). A test reads `BROKER_SITES` and fails if the note stops naming a recognised site.

## (3) zh-Hant journey (LOCAL-001): FALSE, there is none

The app has no i18n framework (no i18next or useTranslation). `locales/` holds `ar, de, en, es, fr, ja, ko, pt` (no zh-Hant) and is only read by `locales/validate.py`, not by the site. `/zh-Hant/scan` and `/zh-hant/scan` are 404 on the live site. The only Traditional Chinese content is the bilingual `/HongKongSpam` page (`src/data/hkSpamCopy.ts`, `htmlLang: "zh-HK"`). So there are no zh-Hant instructions, consent text or error messages for /scan or /start to compare. Filed as a decision.

## (4) Purchase eligibility and service geography on /pricing (PRODUCT-017)

Eligibility that exists: Terms section 2 (at least 16 and legal capacity; the Telegram bot is for 19 and over). Service geography and where paid plans can be bought are defined nowhere in the repo (payment is "planned"; docs/entitlements-mpc-9818.md only describes plan changes). /pricing now states the age rule and that who can buy, and where, will be stated before paid plans open. The actual geography is a business decision (company in Hong Kong, payment provider and tax coverage): filed for Chris.
