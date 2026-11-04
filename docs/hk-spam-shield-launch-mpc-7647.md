# HK Spam Shield: paid launch (MPC-7647)

**Status:** spec and web prep only. No native app is built; this repo is web-only (Vite/React, Supabase, Cloudflare Workers) with no account or billing system yet.

## Product
Paid app that blocks Hong Kong spam calls on-device, on top of the free `/HongKongSpam` registration guide.
Price: **$4.99/month or $39.99/year** (yearly saves 33%). Success: app published, **100+ paying subscribers within 30 days, under 5% churn**.

## Gates before build starts
1. **IVR keys verified** (MPC-7445 / CK-7462: needs a trilingual speaker; `IVR_VERIFIED` is still false).
2. **Chris sign-off and launch switch** (MPC-7545: consent wording, then `indexable: true`, day-10 emails on).
3. **Demand bar met** (below), measured from the day `/HongKongSpam` becomes indexable.
4. Decisions made: billing provider (RevenueCat recommended) and the MPT account system (Supabase Auth, email magic link; own task).

### Demand bar (30 days after `indexable: true`)
| Signal | Go (start Android build) | Review | Stop |
|---|---|---|---|
| "I registered" taps (`hk_spam_registrations`) | 500 or more | 200 to 499 | under 200 |
| Email opt-ins (`reminder_consent`) | 100 or more | 40 to 99 | under 40 |
| Paid-intent signal (Spam Shield waitlist signups, see MPC-7626 pricing waitlist pattern) | 50 or more | 20 to 49 | under 20 |

Go needs the first two signals at "Go". Paid intent below "Go" means rework pricing or positioning before building.

### Post-launch thresholds (app published)
Stretch (task target): 100 paying subscribers in 30 days, under 5% monthly churn. Go/no-go for continued investment: at least 25 paying subscribers in 30 days.

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
