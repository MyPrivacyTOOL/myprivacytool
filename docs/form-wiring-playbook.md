# Form-wiring playbook (MPC-6976)

A repeatable recipe for adding a lead-capture form (waitlist, newsletter, lead magnet) to myprivacytool.io and wiring it to **HubSpot** (lead record) and **GA4** (funnel events). Written for AI agents and humans; follow it top to bottom.

**Reference implementation:** MPC-6961 "AI Access Check" (`src/pages/AIAccessCheck.tsx`, merged in `2425cc8`). Copy its shape; don't reinvent it.

## Architecture at a glance

```
Page component ──submit──▶ src/lib/hubspot.ts ──▶ HubSpot Forms API (portal 246502821)
      │                                             └─ hidden field source_tag, hutk cookie
      └──events──▶ src/lib/analytics.ts ──▶ window.gtag (GA4 G-1BWMDBJSPL, consent-gated)
```

- No backend or secrets are involved. The HubSpot Forms submit endpoint is public and unauthenticated; form GUIDs are public (they ship in every embed).
- GA4 events only fire after the consent manager loads gtag (`trackEvent` no-ops when `window.gtag` is absent).

## Files touched per new form

| File | Change |
|---|---|
| `src/pages/<Name>.tsx` | New page with the form (copy `AIAccessCheck.tsx`) |
| `src/App.tsx` | Import + `<Route path="/<slug>" …>` |
| `scripts/generate-sitemap.mjs` | Add entry to `STATIC_ROUTES` (omit for noindex pages) |
| `src/lib/analytics.ts` | Add `track<Name>View / Cta / Signup` helpers |
| `docs/<name>-experiment.md` | Tracking table, setup checklist, results template |
| `src/lib/hubspot.ts` | **No change** — reuse `submitHubSpotForm` |

## Step-by-step

### 1. Define the spec (before any code)
Record in the Notion task: objective, success criteria, `source_tag` value (kebab-case, e.g. `ai-access-check`), UTM campaign (`mpc-<task number>`), GA4 event names, and who approves copy (Chris approves copy before publish; no spend without approval).

### 2. Create the HubSpot form (needs HubSpot admin or the HubSpot connector)
1. Contact property `source_tag` already exists (single-line text); reuse it.
2. Create a dedicated form named `<Feature> waitlist` with an **email** field and a **hidden** `source_tag` field whose default is your tag.
3. **Publish** the form. An unpublished form rejects submissions.
4. Copy the form GUID.

### 3. Add the page and submit handler
Use `submitHubSpotForm` from `src/lib/hubspot.ts`:

```ts
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_<NAME>_FORM_ID || "<form-guid>";   // GUID is public; env override optional
const SOURCE_TAG = "<source-tag>";

await submitHubSpotForm({
  formId: FORM_ID,
  fields: { email, source_tag: SOURCE_TAG },   // always send source_tag from code too
  pageName: "<Feature> waitlist",
});
```

Rules:
- Always send `source_tag` explicitly in `fields`, even if the form has a hidden default. Segmentation must not depend on form config.
- `submitHubSpotForm` attaches the `hubspotutk` cookie (`hutk`), `pageUri` and `pageName` so the contact ties to the visitor's session. Don't bypass it.
- Use a `idle | loading | success | error` status state; disable the input and button while loading; show `err.message` in a `role="alert"` element.
- Add the privacy-policy link and unsubscribe wording next to the button.

### 4. Capture UTMs
Read `utm_source|medium|campaign|content|term` from `window.location.search` (truncate values to 100 chars), pass them to the analytics helpers, and forward them on outbound links to the free scan (`/?utm_source=…&utm_medium=…&utm_campaign=mpc-<n>`).

### 5. Add GA4 events
In `src/lib/analytics.ts`, add three helpers built on `trackEvent`:

| Event | When | Params |
|---|---|---|
| `<feature>_view` | Page mount (`useEffect`) | `utm_*` |
| `<feature>_cta_click` | Any CTA click | `cta_location` (`hero` \| `post_signup` …) + `utm_*` |
| `<feature>_waitlist_submit` **and** `generate_lead` | Only after HubSpot returns OK | `form`, `method`, `utm_*` |

`generate_lead` is a GA4 recommended event; it must be marked as a **key event** in GA4 Admin (manual, needs an admin).

### 6. Register the route and sitemap
Add the route in `src/App.tsx` and a `STATIC_ROUTES` entry in `scripts/generate-sitemap.mjs` (`postbuild` generates `dist/sitemap.xml`).

### 7. Verify locally
```
npm run lint
npm run build      # also runs the sitemap postbuild
```
Both must pass. There is no CI configured on the repo, so run them yourself before pushing.

### 8. Ship
1. Push to a feature branch and open a **draft PR** (`MPC-<n>: …`). Attach the PR link to the Notion task `Output_Link`.
2. Human reviews copy and merges. Agents do not self-approve copy.
3. After Cloudflare Pages deploys, run a **live test signup** with a throwaway address, then confirm in HubSpot (via the connector or UI) that the contact exists and `source_tag` is set.
4. Confirm GA4 DebugView shows the three events (accept cookies first).
5. Mark `generate_lead` as a key event in GA4.

### 9. Report
Write `docs/<name>-experiment.md` from the template in `docs/ai-access-check-experiment.md` (tracking table, setup checklist, results table). Fill the results 14 days post-launch and link it from the Perplexity MPT Strategy page.

## Definition of done

- [ ] HubSpot form published; hidden `source_tag` present
- [ ] Code sends `source_tag`; `lint` and `build` pass
- [ ] Route + sitemap entry added
- [ ] Live signup produced a HubSpot contact with the right `source_tag`
- [ ] GA4 shows view / CTA / submit / `generate_lead`; key event marked
- [ ] Experiment doc committed; Notion task updated with status and links

## Gotchas

- **Unpublished form** → submit returns a 4xx and the page shows an error. Publish first.
- **Missing `hutk`** (consent declined or cookie blocked) is fine; the lead still lands, just without session attribution.
- **Ad-blockers** can block `api.hsforms.com` or gtag. Treat GA4 as directional; HubSpot is the source of truth for signups.
- **`src/pages/Start.tsx`** contains a `TODO: POST to /api/hubspot-contact` stub. Migrate it to `submitHubSpotForm` using this playbook rather than building a new endpoint.
- **`Index.tsx` newsletter** uses the HubSpot embed script, not the API. Both write to the same portal; don't mix patterns within one page.
- Never commit HubSpot private-app tokens or other secrets. Nothing in this flow needs one.
