# MPC-7200: Performance optimisation and Core Web Vitals audit

FLEET-TASK-V4.2. MOT = MyPrivacyTOOL.

## Goal
Bring the MOT site to good Core Web Vitals (LCP, INP/TBT, CLS) on mobile and desktop, cache and compress assets
correctly on Cloudflare Pages, and verify the site works on iOS Safari and Android Chrome.

## Scope
In: JS/CSS/font/image delivery, route code-splitting, Cloudflare Pages `_headers` caching, layout-shift and
touch-target fixes, mobile form/modal behaviour.
Out (untouched, per constraints): Supabase cutover plan (blocked by MPC-6950), OAuth implementation (MPC-6971),
legal page content (MPC-6545: Privacy, Terms, Cookies are only code-split, their content is unchanged), branding,
content strategy, the consent manager and analytics scripts.

## Method and caveat (read this)
`https://myprivacytool.com` could not be audited directly: the agent sandbox's egress policy returns 403 for that
host. Scores below are Lighthouse 13 against a **local production build** (`npm run build`) served by a small
Cloudflare-Pages-like static server (clean URLs, brotli, `_headers` honoured). Lighthouse default mobile
throttling (slow 4G, 4x CPU) and a desktop profile, Chromium 141. Third-party hosts (consent manager, GTM, HubSpot) are
unreachable in the sandbox and fail fast, so absolute numbers will differ in production; the before/after
**delta** is the meaningful signal. **Re-run Lighthouse against production after deploy** (see Verification).

## Results (local production build, same method before and after)

| Route | Form | Perf before | Perf after | LCP before | LCP after | TBT before | TBT after | CLS before | CLS after |
|---|---|---|---|---|---|---|---|---|---|
| / | mobile | 34 | 70 | 6.6 s | 4.4 s | 1,240 ms | 310 ms | 0 | 0 |
| /scan | mobile | 57 | 80 | 5.5 s | 3.4 s | 220 ms | 70 ms | 0 | 0 |
| /blog | mobile | 58 | 79 | 5.4 s | 3.6 s | 180 ms | 110 ms | 0 | 0 |
| /pricing | mobile | 58 | 80 | 5.5 s | 3.5 s | 200 ms | 70 ms | 0 | 0 |
| /faq | mobile | 60 | 82 | 5.5 s | 3.4 s | 110 ms | 80 ms | 0 | 0 |
| / | desktop | 88 | 98 | 1.0 s | 0.6 s | 10 ms | 10 ms | 0 | 0 |
| /scan | desktop | 88 | 97 | 1.0 s | 0.8 s | 10 ms | 10 ms | 0 | 0 |
| /blog | desktop | 87 | 98 | 1.1 s | 0.8 s | 20 ms | 0 ms | 0 | 0 |
| /pricing | desktop | 87 | 95 | 1.0 s | 0.8 s | 10 ms | 10 ms | 0 | 0.093 |
| /faq | desktop | 88 | 98 | 1.0 s | 0.8 s | 0 ms | 10 ms | 0 | 0 |

Other categories (home, mobile): Accessibility 92 to 100, Best Practices 96 (unchanged), SEO 100 (unchanged).
`/pricing` SEO 69 is the intentional `noindex` placeholder and was left alone (content strategy).
Transfer size on `/`: 801 KiB to 305 KiB. Entry JS: 3,656 KB (844 KB gzip) to 559 KB (154 KB gzip).
INP cannot be measured in lab; TBT (310 ms to 10-110 ms on most routes) is its lab proxy. Field INP/LCP should be
checked in Cloudflare Web Analytics / CrUX after release.

## What was wrong and what changed
1. **One 3.6 MB entry bundle** (TensorFlow.js ~2.5 MB, recharts, jsPDF, all routes). Fixes:
   - Route-level `React.lazy` for every page except `/` (`src/App.tsx`), `Suspense` in `Layout` with a full-viewport
     placeholder so the footer cannot shift into view (CLS).
   - TensorFlow.js loaded on demand inside `languagePredictor.ts` (`import()` on first model use); unused static
     import removed from `federatedLearning.ts`.
   - jsPDF/autotable loaded only when exporting a PDF; `StoragePanel`, `FinalSummaryPanel`, `FingerprintComparison`
     (recharts) lazy.
   - Stable vendor chunks (`vendor-react`, `-radix`, `-supabase`, `-query`) so deploys do not bust the framework cache.
2. **Fonts**: only latin subsets of Inter and Fira Code are imported (was ~40 `@font-face` rules incl. cyrillic/greek).
3. **Images**: header/footer logos downscaled from 666x375 (49 KB) to 300x169 (10 KB), explicit `width`/`height`
   (CLS), blog images lazy/`decoding=async`, blog hero and header logo `fetchpriority=high`.
4. **Caching** (`public/_headers`): `/assets/*` immutable for 1 year (content-hashed), HTML revalidated, other static
   files 1 day + stale-while-revalidate. Lighthouse "cache-insight" flagged 793 KiB before.
5. **Accessibility/mobile**:
   - Viewport no longer sets `user-scalable=no, maximum-scale=1` (WCAG 1.4.4; Lighthouse `meta-viewport` failure).
   - Contrast fix on the hexagon counter (`text-green-400` to the `text-success` brand token).
   - Form fields forced to 16px under 768 px (prevents iOS Safari focus-zoom).
   - 44 px touch targets on mobile (Button, Input, header menu, footer links/social/cookie button, blog links);
     `<Link><Button/></Link>` replaced with `<Button asChild><Link/></Button>` (invalid nested interactive).
   - Alice HD waitlist modal: rendered in a portal (it was positioned against the blurred card, not the viewport,
     and could sit off-screen, e.g. top -43 px on a 390x844 iPhone), `max-h` + internal scroll, `role=dialog`,
     labelled 44 px close button.

## Cloudflare CDN rules (not changeable from the repo, verify in dashboard)
- Compression: Cloudflare compresses text assets (brotli/gzip) at the edge by default on Pages; confirm
  `content-encoding: br` on `/assets/*.js` and `.css`: `curl -sI -H 'accept-encoding: br' https://myprivacytool.com/assets/<file>.js`.
- `_headers` is applied by Pages itself (no zone rule needed). Confirm `cache-control: public, max-age=31536000, immutable`
  on `/assets/*` and `max-age=0, must-revalidate` on HTML after deploy.
- Recommended zone settings if not already on: Brotli, HTTP/3, Early Hints, Always Use HTTPS. Do not enable Rocket
  Loader (it defers the consent manager script and can break consent blocking).

## Mobile responsiveness checklist (automated, headless Chromium with touch emulation)
Devices: iPhone 13 (390x844, iOS Safari UA), Pixel 7 (412x915, Android Chrome UA), iPhone SE (320x568).
Routes (16): `/ /scan /report /blog /blog/:post /pricing /faq /about /contact /newsletter /journey /business
/opt-out-guides /privacy /terms /cookies`.
- [x] No horizontal overflow on any route/device (before and after)
- [x] Mobile menu opens, 8 links reachable, trigger is 44x44
- [x] Newsletter form (Supabase `subscribers` POST): submit works on all 3 devices (network mocked, no real data sent)
- [x] Alice HD waitlist form (HubSpot forms API): opens fully inside viewport, scrolls when short, submits
      on all 3 devices (network mocked)
- [x] All text inputs/selects 16 px on mobile
- [x] No interactive element under 24x24 CSS px (except native consent checkboxes, 13 px with a full-width label,
      and inline mailto links in `/contact`, exempt from WCAG 2.5.8 as inline text)
- [ ] **Not done: real-device iOS Safari / Android Chrome (no device access in the sandbox).** Needs a human
      pass (or BrowserStack) before closing. Emulation does not reproduce Safari-specific bugs.

## Acceptance criteria
- [x] Lighthouse before/after captured (local build; production blocked, see caveat)
- [x] Entry JS reduced > 80% (3.66 MB to 559 KB)
- [x] CLS <= 0.1 on all audited routes
- [x] Mobile perf >= 70 on all audited routes (local); desktop >= 95
- [x] `_headers` caching in place, immutable for hashed assets
- [x] Mobile checklist above (emulated)
- [ ] Production Lighthouse + real-device check after deploy (owner: human, see Verification)
- [ ] PR merged to main (draft PR opened, awaiting review)

## Verification after deploy
1. `npx lighthouse https://myprivacytool.com --form-factor=mobile` (and `--preset=desktop`) for `/ /scan /blog`.
2. Check response headers (cache-control, content-encoding) as above.
3. Smoke test: `/` scan completes, `/newsletter` signup, Alice HD waitlist, PDF export (dynamic jsPDF import).
4. Watch Cloudflare Web Analytics Core Web Vitals (p75 LCP/INP/CLS) for a week.

## Rollback plan
All changes are in one PR with no data/schema/config migration. Revert the merge commit (`git revert -m 1 <sha>`)
and let Cloudflare Pages redeploy, or use the Pages dashboard to roll back to the previous deployment (instant).
The riskiest change is the lazy TensorFlow.js load; if predictions misbehave, revert only
`src/lib/languagePredictor.ts` and `src/lib/federatedLearning.ts`.

## Known limitations / follow-ups
- Home mobile LCP is still ~4.4 s in the lab: the page is a client-rendered SPA (empty `#root` in the HTML). The real
  fix is pre-rendering the home hero into the HTML (separate task). The consent manager script is intentionally
  left render-blocking (it must run first to block trackers).
- `apple-touch-icon.png`, `favicon-16x16.png`, `favicon-32x32.png` are referenced by `index.html` and the manifest
  but missing from `public/` (404 in the console). Needs brand assets, not generated here.
- `alice-video.mp4` (2.4 MB) is only referenced by `VoiceAI`; check it is not fetched eagerly in production.
- 20 pre-existing ESLint errors (`no-explicit-any`, `no-empty`) are unchanged.
