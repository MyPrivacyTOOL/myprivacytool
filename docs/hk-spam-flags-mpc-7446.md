# /HongKongSpam switches (MPC-7446)

Both live in `src/data/hkSpam.json`. The page, the prerendered head, the sitemap and `robots.txt` all read that one file, so they cannot disagree.

| Switch | Default | Effect |
| --- | --- | --- |
| `enabled` (`HK_SPAM_ENABLED`) | `true` | Kill switch. `false` makes `/HongKongSpam` a 404 and hides every HK card (homepage, scan results). It also keeps the page out of the sitemap and disallows it in `robots.txt`. `VITE_HK_SPAM_ENABLED=false` at build time does the same without editing the file. |
| `indexable` (`HK_SPAM_INDEXABLE`) | `false` | The one SEO flag. `false` = noindex, not in the sitemap, disallowed in `robots.txt`, not linked from the site (the HK cards stay hidden for the public). `true` makes all of that open at once. |

Launch order: MPC-7445 confirms the IVR keys, set `IVR_VERIFIED = true` in `src/config/hkDnc.ts`, MPC-7538 finalises the consent wording (set `CONSENT_WORDING_FINAL = true` in `src/data/hkSpamCopy.ts`), then `indexable: true`.

Internal preview (`?hkpreview=1`, localhost, `*.pages.dev`) shows the cards and the placeholder keys even while `indexable` is `false`, as long as `enabled` is `true`.
