# Registry CI check: first-run findings (MPC-9884)

Design: Notion "MPT > Open Tracker — Design & Build Plan (v1)" section 1.4 (repo copy: docs/open-tracker-design-mpc-9882.md in krispyking/openclaw26). Measured 2026-11-08 against `main` at 6b02c85 plus this PR.

This is the real map of what calls out today without going through `shared/recipients/outbound.*`. Every line is in `shared/recipients/ci-allowlist.json`, annotated `pending MPC-9885` (Workers, Functions, shared server code) or `pending MPC-9886` (browser: src/, index.html, public/). **Each task deletes its lines; an entry whose call site is gone FAILS CI until deleted, and an entry older than 14 days FAILS the hygiene job (first expiry 2026-11-22).**

## Totals

| Layer | Findings | Allowlisted | Blocking |
|---|---|---|---|
| 1 Static scan, rule forbidden-api | 140 | 140 | yes |
| 1 Static scan, rule url-literal | 66 | 66 | yes |
| 1 Static scan, rule wrapper-key | 0 | 0 | yes |
| 2 Crawl (480 sitemap routes pre-click, 3 post-click) | 2 | 2 | yes |
| 3 Worker fetch spy | 0 (helper only; adopting it in handler tests is MPC-9885) | 0 | yes |
| 4 Hygiene | 0 failures, 3 warnings | n/a | failures yes, warnings no |

Allowlist size: **208** (147 pending MPC-9885, 61 pending MPC-9886).

## Layer 2: crawl

- `stun:stun.l.google.com` and `stun:stun1.l.google.com` contacted **pre-click** on `/` (recipient google-stun is post_click). This is the STUN call the 2026-11-08 trace missed; the patched RTCPeerConnection records it. Removed by MPC-9886/MPC-9888 (`iceServers: []` before consent).
- Hosts seen otherwise: pre-click `api.myprivacytool.io` (first party) and `challenges.cloudflare.com` (Turnstile, the named exception); post-click `js-na2.hsforms.net`, `api.hsforms.com` (hubspot), Turnstile. All registered. The crawl aborts every external request after recording it, so third-party scripts do not load and cannot reveal the hosts THEY would fetch (GA4 secondary hosts): the crawl proves what OUR pages request, not what a vendor script requests once running.

## Layer 1: forbidden-api by file

| File | Calls | APIs | Owner |
|---|---|---|---|
| functions/api/cairn-commit.ts | 1 | fetch | MPC-9885 |
| functions/api/stripe-checkout.ts | 1 | fetch | MPC-9885 |
| public/footprint/index.html | 2 | fetch | MPC-9886 |
| public/telegram-security-check.html | 1 | fetch | MPC-9886 |
| shared/support/account-lookup.ts | 1 | fetch | MPC-9885 |
| shared/support/email-notifier.ts | 1 | fetch | MPC-9885 |
| shared/support/followup-metrics.ts | 1 | fetch | MPC-9885 |
| shared/support/github-issue-intake.ts | 1 | fetch | MPC-9885 |
| shared/support/openai-compatible-model.ts | 1 | fetch | MPC-9885 |
| shared/support/proof-request.ts | 1 | fetch | MPC-9885 |
| shared/support/proof.ts | 1 | fetch | MPC-9885 |
| shared/support/report-status.ts | 1 | fetch | MPC-9885 |
| shared/support/rest-followup-store.ts | 1 | fetch | MPC-9885 |
| shared/support/rest-store.ts | 1 | fetch | MPC-9885 |
| src/components/RiskProfileSelector.tsx | 1 | fetch | MPC-9886 |
| src/lib/deviceDetection.ts | 1 | fetch | MPC-9886 |
| src/lib/fingerprintDetection.ts | 1 | RTCPeerConnection | MPC-9886 |
| src/lib/hkSpamRegister.ts | 1 | fetch | MPC-9886 |
| src/lib/hkVisitor.ts | 1 | fetch | MPC-9886 |
| src/lib/hubspot.ts | 1 | fetch | MPC-9886 |
| src/lib/learning/events.ts | 1 | fetch | MPC-9886 |
| src/lib/liveScan.ts | 3 | fetch | MPC-9886 |
| src/lib/osintLookup.ts | 1 | fetch | MPC-9886 |
| src/lib/recognise.ts | 2 | fetch | MPC-9886 |
| src/lib/referral.ts | 1 | fetch | MPC-9886 |
| src/lib/scanReport.ts | 1 | fetch | MPC-9886 |
| src/lib/securityDetection.ts | 1 | RTCPeerConnection | MPC-9886 |
| src/lib/telegramHandoff.ts | 1 | fetch | MPC-9886 |
| src/lib/webScan.ts | 1 | fetch | MPC-9886 |
| src/pages/Newsletter.tsx | 1 | fetch | MPC-9886 |
| src/pages/ScanResults.tsx | 1 | fetch | MPC-9886 |
| src/pages/TelegramDashboard.tsx | 1 | fetch | MPC-9886 |
| src/pages/Unsubscribe.tsx | 2 | fetch | MPC-9886 |
| workers/core-brain/index.ts | 1 | fetch | MPC-9885 |
| workers/lib/ab-testing.js | 1 | fetch | MPC-9885 |
| workers/mpt-cairn-blackboard/cairn-push.mjs | 1 | fetch | MPC-9885 |
| workers/mpt-cairn-blackboard/e2e.mjs | 4 | fetch | MPC-9885 |
| workers/mpt-cairn-blackboard/notion-sync.js | 1 | fetch | MPC-9885 |
| workers/mpt-cairn-blackboard/reconcile-cli.mjs | 1 | fetch | MPC-9885 |
| workers/mpt-cairn-blackboard/worker.js | 1 | fetch | MPC-9885 |
| workers/mpt-content-approval/worker.js | 3 | fetch | MPC-9885 |
| workers/mpt-content-consumer/worker.js | 3 | fetch | MPC-9885 |
| workers/mpt-leads/lead-scoring.js | 1 | fetch | MPC-9885 |
| workers/mpt-leads/worker.js | 16 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/channel-osint.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/cloudflare-analytics.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/edge-machines.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/email-delivery.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/ga4.js | 2 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/hubspot-optout.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/hubspot.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/learning-loop.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/meta-ads.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/nightly-chain.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/scan-gap.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/supabase-counts.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/collectors/youtube.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/lib/budget.js | 3 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/publishers/channel-osint.js | 2 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/publishers/kpi-dashboard.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/publishers/learning-loop.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/publishers/machine-mirror.js | 1 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/publishers/notion.js | 2 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/publishers/slack-digest.js | 2 | fetch | MPC-9885 |
| workers/mpt-metrics-collector/worker.js | 1 | fetch | MPC-9885 |
| workers/partner-api/api.ts | 1 | fetch | MPC-9885 |
| workers/scan-report/index.js | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/baseline-scan.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/dashboard-link.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/deep-scan.ts | 2 | fetch | MPC-9885 |
| workers/social-listeners/src/delete-my-data.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/event-extras.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/event-log.ts | 2 | fetch | MPC-9885 |
| workers/social-listeners/src/fix-wizard.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/funnel.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/hubspot-sync.ts | 2 | fetch | MPC-9885 |
| workers/social-listeners/src/mirror-bot.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/photo-exif.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/probe-reader.ts | 3 | fetch | MPC-9885 |
| workers/social-listeners/src/reply.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/shared.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/social.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/telegram-capture.ts | 2 | fetch | MPC-9885 |
| workers/social-listeners/src/x-media.ts | 2 | fetch | MPC-9885 |
| workers/social-listeners/src/x-oauth.ts | 1 | fetch | MPC-9885 |
| workers/social-listeners/src/x-probe.ts | 2 | fetch | MPC-9885 |
| workers/webhook-receiver/deepDive.ts | 1 | fetch | MPC-9885 |
| workers/webhook-receiver/firestore-client.js | 2 | fetch | MPC-9885 |
| workers/webhook-receiver/hubspot-client.js | 1 | fetch | MPC-9885 |
| workers/webhook-receiver/ledger-store.ts | 1 | fetch | MPC-9885 |
| workers/webhook-receiver/state-store.js | 7 | fetch | MPC-9885 |
| workers/webhook-receiver/supabase-client.js | 1 | fetch | MPC-9885 |

## Layer 1: url-literal (registered nowhere) by file

| File | Count | Hosts | Owner |
|---|---|---|---|
| src/components/DNSLeakFixGuide.tsx | 6 | mozilla.cloudflare-dns.com, 1.1.1.1, dns.quad9.net, doh.opendns.com, dns.google | MPC-9886 |
| src/components/FinalSummaryPanel.tsx | 1 | privacyguides.org | MPC-9886 |
| src/components/FingerprintComparison.tsx | 1 | coveryourtracks.eff.org | MPC-9886 |
| src/components/FingerprintPanel.tsx | 1 | browserleaks.com | MPC-9886 |
| src/components/SecurityPanel.tsx | 5 | www.dnsleaktest.com, www.privacytools.io, browserleaks.com, www.eff.org, securityheaders.com | MPC-9886 |
| src/components/SocialAccountsPanel.tsx | 2 | www.facebook.com, login.microsoftonline.com | MPC-9886 |
| src/components/VoiceDebugPanel.tsx | 3 | coveryourtracks.eff.org, amiunique.org, browserleaks.com | MPC-9886 |
| src/data/developerDocs.ts | 2 | channels.myprivacytool.io, myprivacytool-oauth-poc.myprivacytool.workers.dev | MPC-9886 |
| src/lib/githubChannel.ts | 1 | channels.myprivacytool.io | MPC-9886 |
| src/lib/oauthSession.ts | 1 | myprivacytool-oauth-poc.myprivacytool.workers.dev | MPC-9886 |
| src/lib/osintLookup.ts | 1 | api.xposedornot.com | MPC-9886 |
| src/lib/share.ts | 4 | wa.me, x.com, www.linkedin.com, www.facebook.com | MPC-9886 |
| src/lib/socialLinks.ts | 4 | x.com, www.linkedin.com, www.instagram.com, www.facebook.com | MPC-9886 |
| src/pages/Start.tsx | 1 | t.me | MPC-9886 |
| workers/mpt-cairn-blackboard/cairn-push.mjs | 1 | mpt-cairn-blackboard.myprivacytool.workers.dev | MPC-9885 |
| workers/mpt-content-consumer/worker.js | 8 | x.com, www.linkedin.com, www.instagram.com, www.facebook.com, www.pinterest.com, studio.youtube.com, api.anthropic.com, eu1.make.com | MPC-9885 |
| workers/mpt-leads/worker.js | 1 | www.notion.so | MPC-9885 |
| workers/mpt-metrics-collector/collectors/cloudflare-analytics.js | 1 | api.cloudflare.com | MPC-9885 |
| workers/mpt-metrics-collector/collectors/ga4.js | 1 | analyticsdata.googleapis.com | MPC-9885 |
| workers/mpt-metrics-collector/worker.js | 1 | self.internal | MPC-9885 |
| workers/oauth-poc/permissions.js | 1 | myaccount.google.com | MPC-9885 |
| workers/scan-report/lib/guides.generated.js | 14 | www.dnc.gov.sg, www.dnc.gov.hk, www.pcpd.org.hk, www.donotcall.gov.au, help.whitepages.com.au, adma.com.au, www.truecaller.com, www.spokeo.com, www.whitepages.com, www.truthfinder.com, www.fastpeoplesearch.com, www.beenverified.com, www.mylife.com, www.intelius.com | MPC-9885 |
| workers/social-listeners/src/fix-wizard.ts | 1 | t.me | MPC-9885 |
| workers/social-listeners/src/photo-exif.ts | 1 | ns.adobe.com | MPC-9885 |
| workers/social-listeners/src/records-check.ts | 1 | www.spokeo.com | MPC-9885 |
| workers/webhook-receiver/firestore-client.js | 1 | firestore.googleapis.com | MPC-9885 |
| workers/webhook-receiver/pop.ts | 1 | wa.me | MPC-9885 |

Most url-literal findings are user-facing links and diagnostics endpoints (opt-out pages of data brokers, DNS-leak test sites, share links), not requests. They are listed rather than hidden because the scan cannot tell a link from a request; MPC-9886 decides per line: register the recipient, move the link into a documentation-link property (see `link_properties` in shared/recipients/non-outbound.json), or delete it.

## What the scan does not see (stated limits)

- Test files are not scanned (they hold mock hosts by design); the Worker fetch spy is how handler tests are held to the registry.
- A host assembled from visitor input or a redirect: the wrapper's `user_supplied` rules and the crawl cover it, not the static scan.
- An indirect call through an injected `fetchImpl` is not a finding; layer 3 (spy) catches it at test time once handler tests adopt `createFetchSpy`.
- Hosts built from template parts (`https://${x}.supabase.co`) are skipped as dynamic; the wrapper checks them at runtime.
- The live table-vs-file hash comparison needs Supabase credentials; CI proves the seed reproduces from the file offline and the nightly sync-recipients workflow compares the live table.
