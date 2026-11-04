# A/B testing (MPC-7400)

Lightweight, client-side, no third-party library, no cookies. Code: `src/lib/abTest.ts`, hook `src/hooks/useExperiment.ts`, events in `src/lib/analytics.ts`.

## Current experiment: `start_cta`
Where: submit button of the email form on `/start`.
| Variant | Button copy | Share |
|---|---|---|
| `control` | Check My Exposure | 50% |
| `early_access` | Get early access, free | 50% |

It ships **off**: everyone sees `control` until `VITE_AB_START_CTA_ENABLED=true` is set on Cloudflare Pages and the site redeploys. Copy needs Chris's approval first.

## Pricing page experiments (MPC-7638)
Four independent tests on `/pricing`, all **off** until their flag is `true` on Cloudflare Pages (then redeploy). Copy needs Chris's approval first. Bucketing is per experiment, so analyse each on its own.
| Experiment (flag) | Variants |
|---|---|
| `pricing_headline` (`VITE_AB_PRICING_HEADLINE_ENABLED`) | `control` "Pricing" / `free_first` "Know your exposure for free. Wipe your footprints with a plan." |
| `pricing_cta` (`VITE_AB_PRICING_CTA_ENABLED`) | `control` solid "Choose plan" / `outline` outline button / `notify_text` "Get this plan" (paid tiers only) |
| `pricing_tiers` (`VITE_AB_PRICING_TIERS_ENABLED`) | `control` equal cards / `highlight_pro` Pro card emphasised |
| `pricing_social_proof` (`VITE_AB_PRICING_SOCIAL_PROOF_ENABLED`) | `control` none / `above_plans` / `below_plans` trust line |

- Primary conversion = `pricing_waitlist_signup` / `generate_lead` (the notification sign-up in the "Paid plans are in design" pop-up, MPC-7626), split by the `ab_pricing_*` dimension for the test (those events carry `ab_<experiment_id>`, not `variant_id`), divided by `experiment_exposure` for the same `experiment_id` and `variant_id`. Both events and `pricing_plan_click` carry `ab_<experiment_id>` params for cross-test cuts. `experiment_cta_click` (plan button click) is the secondary signal. HubSpot stays the source of truth for signups.
- Time on page and bounce rate: GA4 engagement time and engaged-session rate, broken down by the same `variant_id`.
- Preview: `/pricing?ab_pricing_cta=outline` (forced views are never counted).
- Social proof: no real testimonial or customer count exists, so the trust line only repeats what the Free plan states. Do not add numbers or quotes without a verified source.
- Run at least 14 days. The 20%+ lift goal needs far more traffic than the sample-size rule suggests; use the guidance below and call a winner only at 95% confidence. Rolling out a winner: see "Rotating a winner" (for pricing, edit `HEADLINE`, `PAID_CTA_LABEL`, etc. in `src/pages/Pricing.tsx`).

## Referral programme experiments (MPC-7645)
Three tests across the referral funnel, all **off**. Copy needs Chris's approval first. Referral traffic is small (only people who got a report), so run one test at a time and treat early results as direction, not proof.
| Step | Experiment | Switch | Variants | Chosen by | Read results from |
|---|---|---|---|---|---|
| Report email block | `referral_report_block` | Worker `REFERRAL_AB_REPORT_BLOCK="true"` | `control` "Invite 3 friends, earn free Pro" / `friend_first` "Know someone who would want to see this?" | Worker, hash of the referral code, stored in `users.referral_block_variant` | database (below) + GA4 `experiment_exposure` when the private page opens |
| `/invite` page | `referral_invite_layout` | Pages `VITE_AB_REFERRAL_INVITE_LAYOUT_ENABLED=true` | `control` share link first / `email_first` | browser, per tab session | GA4 `experiment_exposure`, `experiment_cta_click`, `referral_invites_sent` |
| Invitation email | `referral_invite_subject` | Worker `REFERRAL_AB_INVITE_SUBJECT="true"` | `control` "A friend thought you would want to see this" / `specific_subject` "See what your browser and email address give away about you" | Worker, hash of the invited address, stored in `referrals.invite_variant` | database (below) + GA4 `experiment_exposure` on the landing page (`iv` in the link) |
- Apply migration `20261013110000_mpc_7645_referral_ab.sql` before turning a Worker switch on.
- Only the subject line differs in the invitation email, and the block keeps the same honest reward line in both variants.
- Server-chosen tests are counted from the database, so cookie consent does not hide anyone. Run in the Supabase SQL editor:
```sql
-- report block: users who were shown a code, and how many of them sent at least one invitation / had a friend complete
select u.referral_block_variant as variant, count(*) as users_with_code,
       count(*) filter (where exists (select 1 from referrals r where r.referrer_user_id = u.id and r.source = 'invite_email')) as sent_invites,
       count(*) filter (where exists (select 1 from referrals r where r.referrer_user_id = u.id and r.status = 'completed')) as had_completion
from users u where u.referral_block_variant is not null group by 1;
-- invitation subject: friends mailed, signed up, got their report
select invite_variant as variant, count(*) as mailed,
       count(*) filter (where status in ('signed_up','completed')) as signed_up,
       count(*) filter (where status = 'completed') as completed
from referrals where invite_variant is not null group by 1;
```
- A winner needs 95% confidence (two-proportion test) and, given these volumes, will often be "no difference": then keep the control.

## Launch log
| Date | Experiment | Event |
|---|---|---|
| 2026-10-13 | `pricing_headline`, `pricing_cta`, `pricing_tiers`, `pricing_social_proof` | Copy approved; `VITE_AB_PRICING_*_ENABLED=true` set in Cloudflare Pages Production and the site rebuilt. Earliest readout 14 days after the start date (MPC-7638). |
| 2026-10-13 | `pricing_tiers`, `pricing_social_proof` | Switched off (flags removed in Cloudflare Pages) to concentrate low traffic (about 6 sessions/day) on `pricing_headline` and `pricing_cta`. Code unchanged; unset flag means everyone sees the control. Headline and CTA data collected so far stays valid; ignore tiers/trust-line data from the first hours (MPC-7638). |

## How it behaves
- Variant picked once per browser tab session (`sessionStorage`), weighted random. Closing the tab forgets it, so nothing identifies a person across visits.
- Preview a variant: `/start?ab_start_cta=early_access`. Forced views are never counted.
- Exposure is logged when the form appears (after "Yes, that's me"), not on page load.
- GA4 only receives events after cookie consent, like all site analytics; HubSpot remains the source of truth for signups.

## Events
| Event | When | Params |
|---|---|---|
| `experiment_exposure` | Form becomes visible | `experiment_id`, `variant_id` |
| `experiment_cta_click` | Valid submit attempt | `experiment_id`, `variant_id` |
| `generate_lead` / `start_scan_signup` | HubSpot accepted the submit | `experiment_id`, `variant_id` |
| `thank_you_view` | `/thank-you` shown | `source`, `variant_id` |

One-time GA4 setup (admin): register `experiment_id` and `variant_id` as event-scoped custom dimensions.

## Reading results
Per variant: conversion = `generate_lead` events / `experiment_exposure` events (GA4 Explore, free form, filter `experiment_id = start_cta`, break down by `variant_id`).
1. Run at least 14 days and until each variant has about 300 exposures; do not stop early on a good-looking day.
2. Compare with a two-proportion test (any online calculator): call a winner only at 95% confidence and a lift that matters (say 10% relative or more).
3. Check guard metrics did not worsen: `form_validation_error` and `form_submit_error` per submit.
4. Low traffic: if neither variant reaches the sample size in 8 weeks, treat it as no difference and keep the control.
Consent means GA4 sees only part of the traffic; the ratio between variants is still valid, absolute rates are not.

## Rotating a winner
1. Put the winning copy in `CTA_LABEL.control` in `src/pages/Start.tsx` (it becomes the new default).
2. Replace the losing variant with the next challenger (new id, new copy) or remove the experiment entry and unset the flag.
3. Record the result in the Notion task and here (date, exposures, conversion, decision).

## Adding an experiment
Add an entry to `EXPERIMENTS` (first variant = control, flag `VITE_AB_<ID>_ENABLED`), call `useExperiment("<id>")`, fire `trackExperimentExposure` when the element is first visible and `trackExperimentCta` on click, and include `experiment_id`/`variant_id` on the success event. Cloudflare edge splitting is a later option if flicker or SEO ever matters; not needed for a button label.
