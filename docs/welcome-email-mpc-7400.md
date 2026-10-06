# Welcome email trigger (HubSpot) — MPC-7400

Status: **spec only, not configured.** The Claude HubSpot connector can draft marketing emails but cannot create workflows, send, or test, and the portal currently has no marketing emails. A human with HubSpot access builds it from this page (about 15 minutes).

## What the code already sends
Every form submit posts `email`, `source_tag`, `consent_given_at`, `consent_source` (and contact fields) through `submitHubSpotForm`. No code change is needed to trigger a workflow.

| Page | HubSpot form | `source_tag` | Welcome email? |
|---|---|---|---|
| /start | Start Scan `22ee30ae-6cf9-419b-aa46-b656b0e7b1bf` | `start-scan` | Yes |
| /ai-access-check | AI Access Check waitlist `61deaf96-7b03-474d-8285-5d0bf2da13e8` | `ai-access-check` | Yes |
| /contact | Contact (not yet created) | `contact-page` | No: a human replies |
| /business | Business Inquiry | business | No |

## Workflow
1. Workflows > Create > Contact-based, name `MPC-7400 Welcome (waitlist)`.
2. Enrolment: contact has submitted form *Start Scan* OR *AI Access Check waitlist*, AND `consent_given_at` is known. Re-enrolment off.
3. Action: send automated marketing email `MPC-7400 Welcome` (create it as type **Automated**; the type cannot change later). From a verified address, subscription type = the marketing/waitlist type, footer with unsubscribe and company address.
4. Test with a throwaway address on each form; confirm the email arrives and the contact has the right `source_tag`.
5. Set `VITE_WELCOME_EMAIL_LIVE=true` on the Cloudflare Pages project and redeploy so `/thank-you` mentions the email.

## Email copy (draft, needs Chris's approval; every line is true today)
Subject: You're on the list
Preheader: Here's what happens next.

> Hi {{ personalization_token('contact.firstname', 'there') }},
>
> Thanks for signing up to MyPrivacyTOOL. We'll email you when your free privacy report is ready. We only use your email for that, and you can unsubscribe at any time.
>
> While you wait:
> - See your digital shadow: https://www.myprivacytool.io/?utm_source=welcome-email&utm_medium=email&utm_campaign=mpc-7400
> - Remove your data yourself: https://www.myprivacytool.io/opt-out-guides
> - How we handle your data: https://www.myprivacytool.io/privacy
>
> The MyPrivacyTOOL team

Do not add claims about reports being "on the way" or automatic broker removal until fulfilment exists (MPC-6677, MPC-6977 follow-up D).
