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

Priority / changefreq are the values in `scripts/generate-sitemap.mjs`. Keywords reconciled 2026-09-30 against the MPC-005 keyword plan (`#n` = its numbered keyword). Broker-specific long tails (`<broker> opt out`) are not in MPC-005 and remain proposals; MPC-005 volumes are its own estimates, so validate in Ahrefs/Semrush/Search Console before treating any as final.

| URL | Purpose | Primary target keyword | Secondary keywords | Priority |
|---|---|---|---|---|
| `/` | Homepage / free scan entry | data privacy tool (MPC-005 homepage target) | myprivacytool (#20, branded), data removal service (#18, long shot) | 1.0 |
| `/opt-out-guides` | Hub for opt-out guides | data broker opt out guide (#2) | how to opt out of Spokeo WhitePages BeenVerified (#6), do not call registry | 0.9 |
| `/opt-out-guides/spokeo` | Broker guide | spokeo opt out | remove me from spokeo | 0.8 |
| `/opt-out-guides/whitepages` | Broker guide | whitepages opt out | remove me from whitepages | 0.8 |
| `/opt-out-guides/truthfinder` | Broker guide | truthfinder opt out | remove me from truthfinder | 0.8 |
| `/opt-out-guides/fastpeoplesearch` | Broker guide | fastpeoplesearch opt out | remove me from fastpeoplesearch | 0.8 |
| `/opt-out-guides/beenverified` | Broker guide | beenverified opt out | remove me from beenverified | 0.8 |
| `/opt-out-guides/truecaller-unlist-number` | Caller-ID directory guide | unlist number truecaller | remove my number from truecaller | 0.8 |
| `/opt-out-guides/singapore-do-not-call-registry` | Registry guide (SG) | singapore dnc registry | data broker removal service Hong Kong Singapore (#17), stop spam calls singapore | 0.8 |
| `/opt-out-guides/hong-kong-do-not-call-registers` | Registry guide (HK) | hong kong do not call register | ofca unsolicited calls | 0.8 |
| `/opt-out-guides/hong-kong-direct-marketing-opt-out` | Registry guide (HK) | hong kong direct marketing opt out | PDPO personal data protection Hong Kong guide (#7), pdpo 35g opt out | 0.8 |
| `/opt-out-guides/australia-do-not-call-register` | Registry guide (AU) | australia do not call register | stop telemarketing calls australia | 0.8 |
| `/opt-out-guides/australia-white-pages-listing` | Directory guide (AU) | remove white pages listing australia | unlist phone number australia | 0.8 |
| `/opt-out-guides/australia-do-not-mail-register` | Registry guide (AU) | australia do not mail register | stop junk mail australia | 0.8 |
| `/am-i-exposed` | Exposure check landing page | how to check if your data is on data brokers (#3) | what information do data brokers have on me (#9), am i exposed | 0.8 |
| `/scan` | Product: free scan | privacy exposure score (#4) | free data exposure scan | 0.8 |
| `/business` | B2B lead form | employee privacy protection | data broker removal for business | 0.8 |
| `/blog` | Blog index | privacy blog | data privacy tips | 0.7 |
| `/blog/how-exposed-are-you` | Pillar post | what information do data brokers have on me (#9) | how exposed are you online | 0.6 |
| `/blog/25-years-mass-surveillance` | Editorial | mass surveillance history | | 0.6 |
| `/blog/linkedin-data-brokers` | Editorial | linkedin data brokers | linkedin privacy settings | 0.6 |
| `/blog/ai-training-data-opt-out` | Editorial | opt out of ai training data | stop ai training on my data | 0.6 |
| `/report`, `/start`, `/newsletter`, `/ai-access-check` | Funnel / lead pages | (branded / campaign traffic) | | 0.5–0.6 |
| `/privacy`, `/terms`, `/cookies` | Legal | (none) | | 0.3 |

### MPC-005 keywords with no live page yet (content gaps)
| MPC-005 keyword | Intended URL |
|---|---|
| #1 how to remove personal information from internet free, #10 how to delete yourself from the internet | `/guides/remove-my-info-from-internet` (placeholder) |
| #14 remove my name from Google search results | `/guides/remove-from-google` (placeholder) |
| #5 what is a data broker, #8 digital privacy checklist, #16 how to protect your privacy online | new blog / pillar posts (not yet in `blogPosts.json`) |
| #11–13, #15 comparison / alternative keywords | comparison page (not built) |
| #17 data broker removal Hong Kong Singapore | landing page (currently only covered by the registry guides) |

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
| GA4 — `/business` form | Form only sets local state; **nothing is submitted or tracked.** | **Open (tracked in Notion follow-up task):** needs HubSpot wiring per `docs/form-wiring-playbook.md`, then a `generate_lead` event. Not instrumented on purpose: firing a conversion for a form that captures no lead would corrupt data. |
| GA4 — `/start` form | Submit is a `TODO` (no POST). Same issue. | **Open** |
| Page titles / meta descriptions | Scan, Report, Business, Start, Newsletter, Blog, BlogPost and AI Access Check used the generic `index.html` title/description (`ComingSoonPage` and the legal/opt-out pages already set their own). | **Fixed:** new `components/Seo.tsx` sets title, description, og tags and canonical on those pages (BlogPost uses the post title and excerpt). |

## 4. Manual verification still required (needs a live browser / GA4 access)

1. GA4 DebugView on production: submit the AI Access Check and Newsletter forms; confirm `generate_lead` with `method` param and that it is marked as a key event.
2. Google Search Console: submit `/sitemap.xml`, inspect `/privacy` and one blog URL to confirm the user-declared canonical is honoured.
3. Confirm consent-gating still lets `gtag` load before the events fire.

## 5. Change process
Adding or renaming a URL: update this file, `scripts/generate-sitemap.mjs` (unless noindex), the page's `<Helmet>` (title, description, canonical), and add a 301 for any renamed path.
