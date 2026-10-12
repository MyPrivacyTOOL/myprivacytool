# HK Spam Shield: paid launch (MPC-7647)

**Status:** spec and web prep only. No native app is built; this repo is web-only (Vite/React, Supabase, Cloudflare Workers) with no account or billing system yet.

## Product
Paid app that blocks Hong Kong spam calls on-device, on top of the free `/HongKongSpam` registration guide.
Price: **$4.99/month or $39.99/year** (yearly saves 33%). Success: app published, **100+ paying subscribers within 30 days, under 5% churn**.

## Gates before build starts
1. Sprint 2 demand signal from `/HongKongSpam` (registrations, email opt-ins, `hk_spam` UTM traffic). The page is still `indexable: false`.
2. MPC-7445 IVR keys verified (`IVR_VERIFIED`), MPC-7545 consent wording signed off.
3. Decide: MPT account system (none exists) and billing provider.

## Platforms
| Order | Platform | Blocking mechanism | Notes |
|---|---|---|---|
| 1 | Android | `CallScreeningService` (role `ROLE_CALL_SCREENING`) with a local blocklist plus prefix rules | Easier; no call content leaves the device |
| 2 | iOS | CallKit `CXCallDirectoryProvider` call-directory extension (block and identify lists) | Cannot inspect calls; list updates via app refresh; SMS filtering needs a separate Message Filter extension |

## Billing (decision needed)
Store rules require Google Play Billing / Apple IAP for in-app digital subscriptions. Recommended: RevenueCat in front of both stores, webhook into a Worker that writes `hk_shield_entitlements` (migration included). Web checkout (Stripe) is optional and later.

## Account linking
App signs in with the MPT account; the entitlement API returns `{active, plan, current_period_end}` for the account. Blocking works offline from the last cached entitlement plus a grace window.

## Data and privacy
No phone numbers, call logs or SMS content are uploaded. Server stores only the entitlement row. Update the privacy policy section (see MPC-7538) and Play Data Safety / App Privacy labels before submission.

## Implemented in this change
- `src/config/hkShield.ts`: prices, plan ids, targets, `HK_SHIELD_ENABLED = false` launch switch (+ tests).
- `supabase/migrations/20261013100000_mpc_7647_hk_shield_entitlements.sql`: service_role-only entitlements table.

## Not done (needs owners)
Android app, iOS app, store listings, accounts, billing webhook and entitlement API, pricing page copy, paid-conversion analytics events, churn dashboard.
