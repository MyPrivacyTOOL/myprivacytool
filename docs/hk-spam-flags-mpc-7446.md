# /HongKongSpam switches (MPC-7446)

`indexable` lives in `src/data/hkSpam.json`. The page, the prerendered head, the sitemap and `robots.txt` all read that one file, so they cannot disagree.

| Switch | Default | Effect |
| --- | --- | --- |
| `HK_SPAM_ENABLED` (`src/config/hkDnc.ts`, MPC-7450) | on | Kill switch, build variable `VITE_HK_SPAM_ENABLED=false`. Sends `/HongKongSpam` to the homepage and hides every HK card (homepage, scan results). The build scripts honour the same variable, so the page also leaves the sitemap and is disallowed in `robots.txt`. |
| `indexable` (`HK_SPAM_INDEXABLE`, `src/data/hkSpam.json`) | `false` | The one SEO flag. `false` = noindex, not in the sitemap, disallowed in `robots.txt`, not linked from the site (the HK cards stay hidden for the public). `true` makes all of that open at once. |

Launch order: MPC-7445 confirms the IVR keys, set `IVR_VERIFIED = true` in `src/config/hkDnc.ts`, the consent wording and privacy policy section are in (MPC-7538, strings in `src/data/hkSpamCopy.ts`; Chris signs off the wording at MPC-7545), then `indexable: true`.

Internal preview (`?hkpreview=1`, localhost, `*.pages.dev`) shows the cards and the placeholder keys even while `indexable` is `false`, as long as the kill switch is on.
