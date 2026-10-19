# GA4 property audit and baseline (MPC-7376)

Audit of the repo at `main` (`639bf7f`, 2026-10-11). Code review only: no tracking code was changed, and nothing was checked against the live GA4 UI or the production site. Complements `docs/ga4-scan-event-verification-mpc-7506.md` (Data API check on 2026-10-06) and `docs/trust-pages-and-analytics-audit-mpc-6545.md`.

## Summary

- GA4 **is** installed: property `515216281`, measurement ID **`G-1BWMDBJSPL`**, loaded with **gtag.js directly**. There is no Google Tag Manager in the repo.
- The tag is consent-gated through consentmanager.net and is not loaded until the visitor opts in.
- About 70 custom events are implemented behind one helper, `trackEvent()`. There is **no ecommerce tracking** and no `purchase`/`begin_checkout`-style events.
- Main gaps: no SPA `page_view` on route change (relies on a GA4 setting we cannot see from the repo), no `/pricing` tracking, no generic CTA click tracking, no scan-start event, and no dev/staging separation.

## 1. Measurement ID(s)

| ID | Where | Notes |
|---|---|---|
| `G-1BWMDBJSPL` | `index.html:63,71` | The only ID in the codebase. Hardcoded, not read from an env var. |

The same ID is quoted in `docs/` (seo-url-registry, form-wiring-playbook, ai-access-check-experiment) and in `e2e/` comments only. No `GTM-` container ID, no `UA-` ID, no second `G-` ID. `.env.example` has no analytics variable and nothing reads `VITE_GA*`.

## 2. How the tag is loaded

- **File:** `index.html` lines 60-98, in `<head>`. No React component loads it; `src/main.tsx`, `src/App.tsx` and `Layout.tsx` contain no tag code.
- **Method:** inline stub defines `window.dataLayer` and `gtag()`, then injects `https://www.googletagmanager.com/gtag/js?id=G-1BWMDBJSPL` at runtime. This is **gtag.js direct, not GTM**. `googletagmanager.com` here is just the gtag.js host.
- **Consent gating:**
  - The consentmanager.net auto-blocking script loads first (`index.html:61`).
  - `window['ga-disable-G-1BWMDBJSPL']` starts `true`.
  - `allowed()` calls `window.__cmp('getCMPData')` and needs a recorded user choice with at least one purpose consented.
  - `sync()` runs on load and on every CMP `consent` event. On consent it clears the disable flag, injects gtag.js once, then calls `gtag('js', ...)` and `gtag('config', GA_ID)`. On withdrawal it sets the disable flag again.
  - Before consent, `gtag()` calls still queue on `dataLayer` but nothing is sent. They are replayed once gtag.js loads, so pre-consent events are queued and may be sent late.
- **Config:** `gtag('config', GA_ID)` with defaults, so automatic `page_view` on the initial load is on. No `send_page_view: false`, no `debug_mode`, no `user_id`, no consent-mode (`gtag('consent', ...)`) calls.

## 3. Custom events currently implemented

All are sent through `trackEvent(name, params)` in `src/lib/analytics.ts:28`, which calls `window.gtag('event', ...)` and silently no-ops if `window.gtag` is absent. HK funnel events go through `src/lib/hkSpamTrack.ts`, which wraps `trackEvent`.

### Scan funnel and engagement (`analytics.ts`, called from `Index.tsx`, `HexagonGrid.tsx`, `WebScanDashboard.tsx`)
| Event | Trigger |
|---|---|
| `funnel_step` (`step_name`, `step_number`) | `page_load`, `hexagons_visible`, `first_hexagon_confirmed`, `three_confirmed`, `deep_scan_triggered`, `language_/orientation_/fingerprint_/advanced_fingerprint_/storage_/social_/security_/behavior_scan_triggered`, `all_hexagons_confirmed`, `scroll_to_footer` |
| `privacy_scan_completed` | Once per page session. **Meaning depends on the view (changed 2026-10-19, site build 65902cb).** Old grid (`?view=grid`, `HexagonGrid.tsx`): when all hexagons are confirmed one by one. Home-page dashboard (the default since 2026-10-19, `WebScanDashboard.tsx`): when no purple "Is this you?" tile is left, or on arrival if the scan had none; `hexagon_count` is then the number of hexagons on the page (54). Carries first-touch `utm_*`. Canonical O3 KPI event (MPC-7170). Treat 2026-10-19 as a break in the series. |
| `scan_started` | Once per page session. Old grid: first hexagon interaction. Dashboard (default since 2026-10-19): the visitor's first answer (confirm, reject or dispute). See `privacy_scan_completed` above for the break in the series. |
| `device_profile`, `hexagon_confirm`, `hexagon_accuracy`, `time_to_first_confirmation`, `session_duration`, `deep_scan_unlocked` | Home-page scan |
| `error` | Device detection failure (`Index.tsx`) |
| `social_click` (`platform`, `url`) | Footer social icons |

### Voice AI (`VoiceAI.tsx`)
`voice_intro_played`, `voice_session_started`, `voice_ai_stop`, `voice_toggle_off`, `voice_ai_message`, `voice_hexagon_completed`, `hexagons_completed_with_voice`, `voice_scan_completed`, `voice_rate_limit_hit`, `voice_session_completed`.

### Upgrade / waitlist
`upgrade_modal_opened`, `upgrade_modal_closed` (both `tier: alice_hd`), `waitlist_email_submitted` (sends `email_domain` only), `alice_hd_waitlist_submit`.

### Language intelligence panel
`language_prediction_viewed`, `language_profile_detected`, `language_prediction_feedback`, `language_mismatch_detected`, `vpn_likelihood_detected`, `language_family_analysis`, `prediction_accuracy_stats`.

### Lead capture (each also fires `generate_lead` with a `method`)
| Event | `generate_lead` method | Page |
|---|---|---|
| `newsletter_signup` | `newsletter` | `/newsletter`, home embed |
| `ai_access_check_waitlist_submit` | `ai_access_check_waitlist` | `/ai-access-check` |
| `business_audit_request` | `business_inquiry` | `/business` |
| `enterprise_demo_request` | `enterprise_demo` | `/enterprise` |
| `start_scan_signup` | `start_scan` | `/start`, `/scan` |
| `alice_hd_waitlist_submit` | `alice_hd_waitlist` | Alice HD modal |

### Other page events
- `ai_access_check_view`, `ai_access_check_cta_click` (`/ai-access-check`)
- `experiment_exposure`, `experiment_cta_click` (A/B test on `/start`)
- `form_validation_error`, `form_submit_error` (`/start`, `/ai-access-check`, `/contact`)
- `thank_you_view`, `thank_you_next_step_click` (`/thank-you`)
- Blog: `blog_list_view`, `blog_post_click`, `blog_post_view`, `blog_scroll_depth` (25/50/75/100), `blog_cta_click` (`Blog.tsx`, `BlogPost.tsx`, `blogTracking.ts`)
- Hong Kong spam funnel (`/HongKongSpam`, UTM attached): `hk_spam_view`, `hk_spam_dial_tap`, `hk_spam_registered`, `hk_spam_email_submit`, `hk_spam_optout_generated`, `hk_spam_log_added`, `hk_spam_scan_click`, `hk_spam_lang_switch`

Not GA4: `rewardTracking.ts` (`trackReward`, `trackDwellReward`, ...) is an internal learning/reward system and does not send to GA4, despite the `track*` naming. `BehaviorPanel`'s `trackMouseMovement` etc. are detection functions, not analytics.

### Ecommerce and conversion tracking
- **Ecommerce:** none. No `purchase`, `begin_checkout`, `add_to_cart`, `view_item`, `items` payloads.
- **Conversions:** `generate_lead` is the only GA4 conversion-style event. Whether it is marked a key event in the property is not visible from code (`docs/seo-url-registry.md` lists this as unverified).
- Attribution: first-touch `utm_*` captured by `src/lib/attribution.ts`, attached to `privacy_scan_completed` and (in the HK funnel) to its own events. Not attached to the lead events.

## 4. Environment-specific configuration

None. One hardcoded ID for every environment: local dev, Cloudflare Pages preview deployments and production all use `G-1BWMDBJSPL`. There is no hostname check, no `import.meta.env` switch and no separate staging property. Anyone who accepts the consent banner on `localhost` or a `*.pages.dev` preview will send hits into the production property. (`import.meta.env.DEV` is used only to `console.error` inside `trackError`.)

## 5. Analytics utilities

- `src/lib/analytics.ts` - `trackEvent` and ~60 `track*` wrappers (no React hook such as `useAnalytics`; wrappers are plain functions).
- `src/lib/hkSpamTrack.ts` - HK funnel wrapper with UTM persistence in `sessionStorage`.
- `src/lib/blogTracking.ts` - pure helpers for blog scroll depth and CTA detection.
- `src/lib/attribution.ts` - first-touch UTM capture.
- Tests: `analytics`-adjacent unit tests (`hkSpamTrack.test.ts`, `blogTracking.test.ts`, `HongKongSpam.test.tsx`) and `e2e/ga4-scan-completed.spec.ts` (asserts on `window.dataLayer`).

## 6. Routes and expected pageviews

From `src/App.tsx` (all inside `<Layout />`, all lazy-loaded):

| Path | Page |
|---|---|
| `/` | Index (home / scan) |
| `/scan`, `/report`, `/start` | Scan, Report, Start |
| `/business`, `/enterprise` | Business, Enterprise |
| `/newsletter`, `/ai-access-check`, `/thank-you`, `/unsubscribe` | Lead capture / post-submit |
| `/blog`, `/blog/:slug` | Blog list, post |
| `/pricing`, `/about`, `/contact`, `/faq` | Marketing |
| `/privacy`, `/terms`, `/cookies`, `/dpa`, `/trust` | Legal / trust |
| `/opt-out-guides`, `/opt-out-guides/:slug` | Opt-out guides |
| `/journey`, `/am-i-exposed`, `/connect/github`, `/developers` | Product / developer |
| `/HongKongSpam` | HK spam-call funnel |
| `*` | NotFound |

Redirects (no page of their own): `/guides/remove-my-info-from-internet`, `/guides/remove-from-google`, `/guides/stop-spam` (to `/blog/...`), `/stop-spam-hk`, `/hong-kong-spam` (to `/HongKongSpam`).

`src/pages/Accessibility.tsx` and `src/pages/GDPRRights.tsx` exist but are **not routed**.

## 7. Gaps and issues

1. **SPA pageviews are not explicitly tracked.** Only the initial load gets the automatic `page_view`. There is no `page_view` on React Router navigation (`Layout.tsx` has no such effect). Subsequent routes are counted only if the GA4 web stream has Enhanced Measurement "Page changes based on browser history events" enabled. Verify in GA4 Admin; otherwise most pageviews beyond the landing page are missing.
2. **No dev/staging separation** (see section 4). Local and preview traffic can pollute production data once consent is given.
3. **Events before consent are queued, not dropped.** `gtag()` pushes to `dataLayer` regardless; if gtag.js loads after consent, the queued events are processed then. Decide whether that is acceptable under the Cookie Policy.
4. **No Google Consent Mode.** The gating is "load or don't load", so there is no cookieless modelling for non-consenting visitors and no `ad_*` signal handling.
5. **Pricing page tracking (updated CK-7721 C).** `Pricing.tsx` fires `pricing_view` on load and `pricing_plan_click` (`plan` = free, basic, pro, executive or business; `cta_location` = `pricing_card`; `destination`; plus `ab_<experiment>` variants) for each plan button and the business quote link. The events go through `trackEvent` in `src/lib/analytics.ts`, which only sends when `window.gtag` exists, i.e. after analytics consent loaded gtag.js; they carry no personal data. Purpose: real plan interest, the only valid price evidence while paid plans are not open. Unit-tested with and without consent in `Pricing.test.tsx`. To check live: GA4 DebugView, or the network log (`collect` requests) with consent on (events appear) and off (no `collect` requests).
6. **No generic CTA tracking.** Only blog CTAs, `/ai-access-check` hero, experiment CTA on `/start`, and `thank_you_next_step_click` are tracked. Header and home hero CTAs are not.
7. **No explicit scan-start event.** The funnel starts at `funnel_step: page_load` for every home visit, so "started a scan" cannot be separated from "landed on the page". `/scan` and `/start` fire only on signup.
8. **`funnel_step` numbering is incomplete.** `funnelSteps` has no entries for the `*_scan_triggered` steps other than `deep_scan_triggered`, and `five_confirmed` is defined but never emitted; unknown steps get `step_number: 0`.
9. **Custom dimensions/metrics are not registered** (per `docs/ga4-scan-event-verification-mpc-7506.md`: 0 custom dimensions, 0 custom metrics; the connected account lacked `analytics.edit`). `step_name`, `hexagon_count`, `utm_*`, `method`, `form` etc. will not appear in standard reports until registered.
10. **`privacy_scan_completed` had 0 rows** at the 2026-10-06 check. Needs re-checking now that more time has passed.
11. **Possible duplicate lead events:** `generatelead2` (125 events) appears next to `generate_lead` (135) in GA4 but is not emitted by this repo; it looks like a GA4 UI-created event or other tag. Confirm it does not double count.
12. **`trackError` sends `error_message`** as a free-text parameter; check messages cannot contain user data.
13. **Lead events carry no attribution.** `generate_lead` and the per-form events do not include `utm_*`, so lead-by-source needs the session-level source in GA4 rather than event parameters.
14. **Hardcoded ID.** Changing property requires editing `index.html` (and docs); an env-driven ID would also solve item 2.

## 8. Recommendations

Priority order. None of these are done in this PR.

1. **Verify SPA pageviews** in GA4 (Admin > Data streams > Enhanced measurement > Page changes). If it is off or unreliable, add an explicit `page_view` on route change in `Layout.tsx`, with `send_page_view: false` on the initial `config` to avoid doubles.
2. **Pricing:** `pricing_view` (or rely on `page_view`), `pricing_plan_click` (`plan`, `cta_location`) per tier button, and `begin_checkout`/`select_item` when checkout exists. (`pricing_view` and `pricing_plan_click` are done, CK-7721 C; `begin_checkout`/`select_item` wait for checkout.)
3. **CTA clicks:** one `cta_click` event with `cta_id`, `cta_location` (header, hero, footer, pricing, blog) and `destination`, wired to the primary CTAs.
4. **Scan initiation:** `scan_started` when the visitor first interacts with the scan (first hexagon opened, or the `/scan` and `/start` entry button), so a funnel `page_view` -> `scan_started` -> `first_hexagon_confirmed` -> `privacy_scan_completed` -> `generate_lead` can be built.
5. **Environment split:** read the measurement ID from a Vite env var, and disable or point to a separate property on `localhost` and `*.pages.dev`.
6. **Register custom dimensions and metrics** (needs `analytics.edit`): `step_name`, `utm_source`, `utm_campaign`, `method`, `form`, `source`, `plan`, `cta_location`; metric `hexagon_count`.
7. **Mark `generate_lead` and `privacy_scan_completed` as key events** and resolve the `generatelead2` duplicate.
8. **Attach attribution to lead events** by routing them through `attributedEvent`.
9. **Consider Google Consent Mode v2** if non-consented modelling or ads are planned.
10. Fix the `funnel_step` number map and either emit or delete `five_confirmed`.
11. Revisit routes: `/Accessibility` and `/GDPRRights` pages are unreachable, so they get no pageviews.

## 9. How this was checked

Searched all files (excluding `node_modules` and lockfiles) for `gtag`, `G-` IDs, `googletagmanager`, `google-analytics`, `dataLayer`, `GTM-`, `trackEvent`, `useAnalytics`, `VITE_GA*`, and read `index.html`, `src/lib/analytics.ts`, `hkSpamTrack.ts`, `blogTracking.ts`, `src/App.tsx`, `Layout.tsx`, `.env.example` and all `trackX` call sites. Live behaviour (consent gating, GA4 ingestion, Enhanced Measurement settings, key events) was **not** verified and needs a browser or GA4 access.
