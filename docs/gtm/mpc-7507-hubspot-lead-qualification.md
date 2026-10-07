# MPC-7507: HubSpot CRM lead qualification automation

Portal **246502821** (MyPrivacyTOOL, na2, US/Eastern, USD). Checked 2026-10-06 through the HubSpot connector as `myprivacytool@gmail.com` (owner/user 93945070).

## 1. Write-access check

| Capability | Result |
|---|---|
| Contacts / companies / deals / tickets / tasks / notes: read + write | AVAILABLE |
| Marketing email, landing page, marketing event: read + write | AVAILABLE |
| Contact property *definitions* (create/edit) | Not exposed by the connector (read-only via `get_properties`). Needs the HubSpot UI or a private-app token with `crm.schemas.contacts.write`. |
| **Workflows (automation)** | **Not exposed.** The connector has no workflow object or tool, so workflow write access cannot be confirmed or used from here. Build the workflows in the HubSpot UI (section 4). |
| Lists/segments (`OBJECT_LIST`), forms, invoices, quotes: write | Forms: no write. Lists: needs reauthorization (a segment tool, `manage_segment`, exists separately). |
| Portal onboarding | `onboarded: false` |
| Account type | `STANDARD` |

**Open blockers for the human (Chris):**
1. In HubSpot, confirm the Marketing Hub tier. Workflows need **Professional or higher** and lead scoring (`hs_lead_score`, "Score" tool) also needs Professional. If the portal is Starter or Free, the sequence below must be run with Lists plus manual tasks, or the tier upgraded.
2. Confirm the user has the **Workflows: edit** permission, which is not visible through the connector.
3. Reauthorize the connector if list/segment write is wanted from Claude.

## 2. Contact property map

Existing contact properties (from the portal) and how each feeds qualification:

| Signal | Property | Type | Source today | Use |
|---|---|---|---|---|
| Identity | `email`, `firstname`, `lastname` | text | All forms | Dedupe key |
| Company | `company` | text | `/business` form | Fit |
| Company size | `numemployees` (1-5 ... 1000+) | enum | Not collected on forms | Fit scoring |
| Persona | `role` (administrator / decision_maker / end_user), `jobtitle`, `seniority`, `job_function` | enum/text | Not collected on forms | Fit scoring |
| Origin | `source_tag` | text | Every form (kebab-case tag) | Routing and nurture branch |
| Origin detail | `lead_source_platform`, `lead_source_platform_dropdown`, `platform_user_id` | text/enum | App | Product-user link |
| Product signal | `privacy_risk_score` (number), `data_broker_confirmed` (number) | number | App scan results | Intent scoring |
| Engagement | `usage_frequency` (daily/weekly/monthly), `onboarding_completion_date`, `waitlist`, `feedback_provided` | mixed | App | Intent scoring |
| Consent | `consent_given_at`, `consent_source` | date/text | `consentFields()` in `src/lib/hubspot.ts` | Gate: no marketing sends without it |
| Stage | `lifecyclestage`, `hs_lead_status` | enum | Workflows / sales | Output |
| Sales | `engagements_last_meeting_booked*` | date/text | Calendly/meetings | Handoff trigger |

Gaps to fix:
- **`contact_topic`** is sent by `src/pages/Contact.tsx` but did not show up in the contact property list. Confirm the property exists, or HubSpot silently drops it.
- **`lead_source_platform_dropdown`** has junk options (`platform_user_id`, `privacy_risk_score number`, `data_broker_confirmed number)`). Looks like a mis-created property; do not build on it. Use `source_tag`.
- Add one custom number property **`lead_score_mpt`** (or use the built-in `hs_lead_score` if the tier allows) so scoring is visible and reportable.
- `numemployees`, `role`, `jobtitle` are never collected. Add `numemployees` and `role` as optional fields on the `/business` form (code change in `src/pages/Business.tsx` plus the HubSpot form; needs a copy decision from Chris).

## 3. Lead-scoring model (proposed)

Scores are additive, 0-100. Fit and intent are tracked in one number first; split into two properties later if needed.

**Fit (max 40)**
- `numemployees` 25+ : +15; 5-25 : +8
- `role` = decision_maker : +15; administrator : +10; end_user : +3
- `source_tag` = business audit form : +10

**Intent (max 60)**
- Submitted `/business` audit request: +30
- Submitted `/contact` with topic = sales/audit: +20
- `privacy_risk_score` >= 70 : +15 (high exposure = real pain)
- `data_broker_confirmed` >= 3 : +10
- `onboarding_completion_date` is known : +10
- `usage_frequency` = daily or weekly : +10
- Booked meeting (`engagements_last_meeting_booked` known): +20 (also direct MQL to SQL trigger)
- No engagement in 60 days : -15 (decay)

**Thresholds**
- 0-24: Subscriber/Lead, nurture
- 25-49: Lead, active nurture
- 50-69: **MQL** (`lifecyclestage = marketingqualifiedlead`)
- 70+ or meeting booked: **SQL** (`salesqualifiedlead`), create task for owner

Thresholds are starting guesses with no conversion data yet. Review after 30 days / ~50 leads.

## 4. Workflow specs (build in HubSpot UI)

All contact-based, re-enrollment ON, and **every one requires `consent_given_at` is known** before any email step.

1. **WF-1 Score and stage.** Enroll on any property change in the scoring set. Branch by score. Set `lead_score_mpt`; at 50 set lifecycle = MQL; at 70 set lifecycle = SQL and `hs_lead_status = OPEN`.
2. **WF-2 Sales handoff.** Enroll on lifecycle = SQL. Assign owner (93945070 until more owners exist), create task "Qualify <email> within 1 business day" due in 1 day, send internal notification.
3. **WF-3 Business audit nurture** (`source_tag` is the business audit tag). Day 0 thank-you and what-happens-next; day 2 sample audit/value; day 5 case or FAQ; day 9 meeting link; exit on meeting booked, unsubscribe, or SQL.
4. **WF-4 Scan/consumer nurture** (`/start`, AI access check tags). Day 0 results recap; day 3 "fix your top exposure" guide; day 7 broker-removal explainer; day 14 upgrade/onboarding nudge; exit on `onboarding_completion_date` known.
5. **WF-5 Re-engagement and decay.** No engagement in 60 days: -15 score, send one re-permission email, then set `hs_lead_status = BAD_TIMING` if still silent after 14 days. Do not suppress unsubscribes.

Email copy for these sequences needs Chris's approval before publish (per the form-wiring playbook). No sends or spend until then.

## 5. Segments (not yet created)

Creating these through the connector failed on 2026-10-06: the HubSpot connection lacks `crm.segments.write` and `crm.lists.write`. Reconnect the HubSpot app and tick those scopes (or ask a HubSpot admin to approve them), then re-run, or create them by hand as active lists:

| Segment | Filter |
|---|---|
| MPT - Consented leads (nurture pool) | `consent_given_at` is known AND `lifecyclestage` is Subscriber or Lead |
| MPT - High exposure (hot) | `consent_given_at` is known AND `privacy_risk_score` >= 70 |
| MPT - Business audit leads | `consent_given_at` is known AND `source_tag` = `business-inquiry` |

The `/business` form sends `source_tag = "business-inquiry"` (`src/pages/Business.tsx`). Sections 3-4 say "business audit tag"; that means this value.

Only 9 contacts carry a `source_tag` today and the ones sampled are test emails, so segment sizes will be near zero until real traffic arrives.

## 6. Next steps

1. Chris confirms the HubSpot tier and workflow-edit permission (section 1).
2. Create `lead_score_mpt`, fix/confirm `contact_topic`, add the two form fields (section 2).
3. Build WF-1 and WF-2 first (no email, low risk), then WF-3 to WF-5 once copy is approved.
4. Backtest: apply the model to existing contacts via a list and sanity-check MQL/SQL volume before turning on tasks.
