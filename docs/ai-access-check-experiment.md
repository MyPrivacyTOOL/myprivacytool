# MPC-6961 — "AI Access Check" lead-magnet experiment

**Page:** `/ai-access-check` · **Free scan link:** `/` (with `utm_campaign=mpc-6961`)
**Duration:** 14 days from launch · **Report due:** launch + 14 days

## Hypothesis
Framing the free scan as an "AI Access Check" converts cold/social traffic to waitlist signups at a higher rate than the existing newsletter form.

## Tracking

| Signal | Where | Name |
|---|---|---|
| Page view | GA4 | `ai_access_check_view` (+ `utm_*` params) |
| Scan CTA click | GA4 | `ai_access_check_cta_click` (`cta_location`: `hero` \| `post_signup`) |
| Waitlist signup | GA4 | `ai_access_check_waitlist_submit` + `generate_lead` (mark as **key event** in GA4 Admin) |
| Waitlist signup | HubSpot | Forms API submit to portal 246502821, with `hutk` cookie so it ties to the visitor |

GA4 property G-1BWMDBJSPL. Events only fire after the consent manager allows analytics.

## Setup checklist (needs HubSpot / GA4 admin)
- [ ] Create a dedicated HubSpot form "AI Access Check waitlist" and set `VITE_HUBSPOT_AI_CHECK_FORM_ID` (page currently falls back to the newsletter form GUID).
- [ ] Add a HubSpot list/workflow filtering on that form so signups are segmentable.
- [ ] Mark `generate_lead` as a key event in GA4.
- [ ] Use `?utm_source=…&utm_medium=…&utm_campaign=mpc-6961` on every promoted link.

## Success metrics
- Visitors → waitlist conversion rate (target: to be set at launch; baseline = newsletter form on `/`)
- Visitors → free-scan click-through rate
- Signups by `utm_source`

## Results report (fill in at day 14)

| Metric | Value |
|---|---|
| Sessions on `/ai-access-check` | |
| `ai_access_check_cta_click` | |
| Scan CTR | |
| Waitlist signups (HubSpot) | |
| Signup conversion rate | |
| Top sources | |

**Findings / recommendation:** _(continue, iterate, or stop)_
