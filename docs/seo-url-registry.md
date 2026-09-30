# SEO architecture & URL naming registry (MPC-6977)

Source of truth for URL naming decisions, the high-value URL list with target keywords, and the canonical / sitemap / GA4 audit. Mirrored in Notion: *MyPrivacyTOOL → 15 · Marketing → SEO & URL Strategy*.

Site origin: `https://www.myprivacytool.io` (www, https, no trailing slash).

## 1. URL naming conventions

| Rule | Rationale |
|---|---|
| Lowercase, hyphen-separated, no underscores, no file extensions | Google treats hyphens as word separators; keeps URLs readable and shareable. |
| Full words over abbreviations: `/opt-out-guides`, not `/optout` or `/oo` | Matches how people search ("opt out"); the hyphenated form ranks for both "opt out" and "opt-out" queries and is self-describing in SERPs. |
| Plural hub, singular-by-slug children: `/opt-out-guides` → `/opt-out-guides/<broker-or-registry>` | One hub page collects links and topical authority; each child targets one long-tail query (`spokeo opt out`). |
| Slugs name the entity, not the action, for opt-out children (`spokeo`, `singapore-do-not-call-registry`) | Stable if the procedure changes; entity name is the search term. |
| Region words live in slugs only when the registry is region-specific (`hong-kong-…`, `australia-…`, `singapore-…`) | Disambiguates similarly named registries and captures geo-modified queries. |
| Evergreen how-to guides live under `/guides/<verb-phrase>` (`/guides/remove-from-google`) | Separates task-oriented guides from the broker/registry directory. Currently placeholder (noindex). |
| Editorial content under `/blog/<slug>`; slug = short keyword phrase, no dates | Dates in URLs make refreshed posts look stale. |
| Tool/funnel pages get one short noun or verb phrase (`/scan`, `/am-i-exposed`, `/ai-access-check`) | Memorable, directly linkable from ads and social. |
| Never rename a live URL without a 301 and a registry update | Preserves link equity; the registry is the change log. |
| One canonical per page, self-referencing, absolute, https + www | Prevents duplicate-content splits between `/x`, `/x/` and `?utm_*` variants. |
| Campaign tracking only via UTM parameters (`utm_campaign=mpc-<task>`), never in the path | Keeps paths clean; canonical strips the query string. |

## 2. Registry: indexable, high-value URLs

Priority / changefreq are the values in `scripts/generate-sitemap.mjs`. Keywords are **proposed** from page intent and the existing Marketing → SEO pages (MPC-005, Content & SEO Strategy); confirm volumes before treating them as targets.

| URL | Purpose | Primary target keyword | Secondary keywords | Priority |
|---|---|---|---|---|
| `/` | Homepage / free scan entry | free privacy scan | see what data brokers know about me, digital footprint checker | 1.0 |
| `/opt-out-guides` | Hub for opt-out guides | data broker opt out guides | remove my information from people search sites, do not call registry | 0.9 |
| `/opt-out-guides/spokeo` | Broker guide | spokeo opt out | remove me from spokeo | 0.8 |
| `/opt-out-guides/whitepages` | Broker guide | whitepages opt out | remove me from whitepages | 0.8 |
| `/opt-out-guides/truthfinder` | Broker guide | truthfinder opt out | remove me from truthfinder | 0.8 |
| `/opt-out-guides/fastpeoplesearch` | Broker guide | fastpeoplesearch opt out | remove me from fastpeoplesearch | 0.8 |
| `/opt-out-guides/beenverified` | Broker guide | beenverified opt out | remove me from beenverified | 0.8 |
| `/opt-out-guides/truecaller-unlist-number` | Caller-ID directory guide | unlist number truecaller | remove my number from truecaller | 0.8 |
| `/opt-out-guides/singapore-do-not-call-registry` | Registry guide (SG) | singapore dnc registry | stop spam calls singapore | 0.8 |
| `/opt-out-guides/hong-kong-do-not-call-registers` | Registry guide (HK) | hong kong do not call register | ofca unsolicited calls | 0.8 |
| `/opt-out-guides/hong-kong-direct-marketing-opt-out` | Registry guide (HK) | hong kong direct marketing opt out | pdpo 35g opt out | 0.8 |
| `/opt-out-guides/australia-do-not-call-register` | Registry guide (AU) | australia do not call register | stop telemarketing calls australia | 0.8 |
| `/opt-out-guides/australia-white-pages-listing` | Directory guide (AU) | remove white pages listing australia | unlist phone number australia | 0.8 |
| `/opt-out-guides/australia-do-not-mail-register` | Registry guide (AU) | australia do not mail register | stop junk mail australia | 0.8 |
| `/am-i-exposed` | Exposure check landing page | am i exposed | is my data on data broker sites | 0.8 |
| `/scan` | Product: free scan | free data exposure scan | privacy scan online | 0.8 |
| `/business` | B2B lead form | employee privacy protection | data broker removal for business | 0.8 |
| `/blog` | Blog index | privacy blog | data privacy tips | 0.7 |
| `/blog/how-exposed-are-you` | Pillar post | how exposed are you online | what data is tracked about me | 0.6 |
| `/blog/25-years-mass-surveillance` | Editorial | mass surveillance history | | 0.6 |
| `/blog/linkedin-data-brokers` | Editorial | linkedin data brokers | linkedin privacy settings | 0.6 |
| `/blog/ai-training-data-opt-out` | Editorial | opt out of ai training data | stop ai training on my data | 0.6 |
| `/report`, `/start`, `/newsletter`, `/ai-access-check` | Funnel / lead pages | (branded / campaign traffic) | | 0.5–0.6 |
| `/privacy`, `/terms`, `/cookies` | Legal | (none) | | 0.3 |

### Intentionally excluded (noindex placeholders, `ComingSoonPage`)
`/pricing`, `/about`, `/contact`, `/faq`, `/guides/remove-my-info-from-internet`, `/guides/remove-from-google`, `/guides/stop-spam`. Add each to `STATIC_ROUTES` and remove `ComingSoonPage` when the real page ships. `NotFound` is noindex.

## 3. Audit results (2026-09-30)

| Check | Finding | Status |
|---|---|---|
| Canonical | Only `index.html` (homepage), the opt-out hub/children and `/am-i-exposed` had canonicals. Because `index.html` is served for every SPA route, all other pages inherited the **homepage** canonical. | **Fixed:** `Layout.tsx` now emits a self-referencing canonical per route; pages with their own `<Helmet>` canonical still override it. |
| 404 | `NotFound` had no robots directive. | **Fixed:** `noindex`. |
| Sitemap | `/privacy`, `/terms`, `/cookies` (indexable) were missing. Blog posts (4), opt-out guides (12) and 10 static routes already present. | **Fixed:** added; sitemap now 29 URLs. |
| GA4 base tag | `G-1BWMDBJSPL` in `index.html`; `trackEvent` no-ops when `gtag` absent. | OK |
| GA4 `generate_lead` — AI Access Check | Fires via `trackAIAccessCheckSignup`. | OK (verify live, below) |
| GA4 `generate_lead` — Newsletter | No event fired on signup. | **Fixed:** `trackNewsletterSignup` fires `newsletter_signup` + `generate_lead` on success. |
| GA4 — `/business` form | Form only sets local state; **nothing is submitted or tracked.** | **Open:** needs HubSpot wiring per `docs/form-wiring-playbook.md`, then a `generate_lead` event. Not instrumented on purpose: firing a conversion for a form that captures no lead would corrupt data. |
| GA4 — `/start` form | Submit is a `TODO` (no POST). Same issue. | **Open** |
| Page titles / meta descriptions | Pages using `ComingSoonPage`, Blog, BlogPost, Business, Scan, Report, Start, Newsletter and AI Access Check have no per-page `<title>`/description in Helmet (they use the generic `index.html` ones). | **Open (follow-up):** add per-page metadata. |

## 4. Manual verification still required (needs a live browser / GA4 access)

1. GA4 DebugView on production: submit the AI Access Check and Newsletter forms; confirm `generate_lead` with `method` param and that it is marked as a key event.
2. Google Search Console: submit `/sitemap.xml`, inspect `/privacy` and one blog URL to confirm the user-declared canonical is honoured.
3. Confirm consent-gating still lets `gtag` load before the events fire.

## 5. Change process
Adding or renaming a URL: update this file, `scripts/generate-sitemap.mjs` (unless noindex), the page's `<Helmet>` (title, description, canonical), and add a 301 for any renamed path.
