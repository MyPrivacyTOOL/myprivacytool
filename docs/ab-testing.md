# A/B testing (MPC-7400)

Lightweight, client-side, no third-party library, no cookies. Code: `src/lib/abTest.ts`, hook `src/hooks/useExperiment.ts`, events in `src/lib/analytics.ts`.

## Current experiment: `start_cta`
Where: submit button of the email form on `/start`.
| Variant | Button copy | Share |
|---|---|---|
| `control` | Check My Exposure | 50% |
| `early_access` | Get early access, free | 50% |

It ships **off**: everyone sees `control` until `VITE_AB_START_CTA_ENABLED=true` is set on Cloudflare Pages and the site redeploys. Copy needs Chris's approval first.

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
