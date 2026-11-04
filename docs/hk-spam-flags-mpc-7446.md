# /HongKongSpam switches (MPC-7446)

`indexable` lives in `src/data/hkSpam.json`. The page, the prerendered head, the sitemap and `robots.txt` all read that one file, so they cannot disagree.

| Switch | Default | Effect |
| --- | --- | --- |
| `HK_SPAM_ENABLED` (`src/config/hkDnc.ts`, MPC-7450) | on | Kill switch, build variable `VITE_HK_SPAM_ENABLED=false`. Sends `/HongKongSpam` to the homepage and hides every HK card (homepage, scan results). The build scripts honour the same variable, so the page also leaves the sitemap and is disallowed in `robots.txt`. |
| `indexable` (`HK_SPAM_INDEXABLE`, `src/data/hkSpam.json`) | `true` (launched 2026-10-14, approved by Chris) | The one SEO flag. `false` = noindex, not in the sitemap, disallowed in `robots.txt`, not linked from the site (the HK cards stay hidden for the public). `true` makes all of that open at once. |

Launch order: MPC-7445 confirms the IVR keys, set `IVR_VERIFIED = true` in `src/config/hkDnc.ts`, the consent wording and privacy policy section are in (MPC-7538, strings in `src/data/hkSpamCopy.ts`; Chris signs off the wording at MPC-7545), then `indexable: true`.

Internal preview (`?hkpreview=1`, localhost, `*.pages.dev`) shows the cards and the placeholder keys even while `indexable` is `false`, as long as the kill switch is on.

**Launched 2026-10-14.** `indexable` is `true` (Chris approved). The page is indexable, in the sitemap, allowed in `robots.txt`, and the homepage and scan-result cards show for Hong Kong visitors. To pull it back: set `indexable` back to `false` (or `VITE_HK_SPAM_ENABLED=false` for the full kill switch) and redeploy. Still open at launch: phone auto-send re-test (MPC-7540), Chinese review (MPC-7542), screenshots / Lighthouse / 360px (MPC-7446-F1), GA4 DebugView (MPC-7446-F2).
