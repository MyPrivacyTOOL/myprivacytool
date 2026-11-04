# LinkedIn company Page: setup guide and ready-to-paste fields (MPC-7504 / MPC-117)

Status 2026-10-07: **no company Page exists yet** (confirmed by the owner). `src/lib/socialLinks.ts` still points at a personal profile.
This unblocks `docs/channels/linkedin-publishing.md` and the LinkedIn post in `docs/gtm/mpc-117/social-posts.md`.

The steps below come from LinkedIn's own help pages as found by web search on 2026-10-07; I could not open LinkedIn from my sandbox, so button names may differ slightly from what you see.
- LinkedIn Help: add an email domain to a Page, to enable member verification: <https://www.linkedin.com/help/learning/answer/a6278544>
- Create a Page: <https://www.linkedin.com/company/setup/new/> (if it redirects, use the **For Business** grid in the LinkedIn top bar, then **Create a Company Page**).

## Prerequisites (this is the part most likely to block you)
1. **A personal LinkedIn profile** that is at least a day old, has more than one connection, lists you as working at MyPrivacyTOOL Ltd, and has a **confirmed email address**.
2. **A work email on the company's own domain**, for example `chris@myprivacytool.io`. LinkedIn treats this as a firm requirement; a Gmail address does not count.
   - The site lists `privacy@`, `support@`, `dpo@`, `legal@`, `accessibility@` and `scan@` at myprivacytool.io, but I cannot tell from here which of those actually receive mail or whether any is a named person's address.
   - If you need one: in Cloudflare open the `myprivacytool.io` zone, then **Email > Email Routing**, create `chris@myprivacytool.io` and forward it to your existing inbox (Cloudflare Email Routing is free; confirm in your dashboard). Then add that address to your LinkedIn profile (**Settings > Sign in & security > Email addresses**) and confirm it.
3. A square logo (see Assets below).

## Steps
1. Sign in to LinkedIn as the person who will be the Page's first admin (the owner).
2. Go to <https://www.linkedin.com/company/setup/new/> and choose **Company**.
3. Fill the fields in the next section. Tick the box confirming you are authorised to create the Page, then **Create page**.
4. If LinkedIn asks for workplace verification, verify with the company-domain email from step 2 above.
5. Add the second admin (Page **Admin tools > Manage admins**): `docs/channels/linkedin-publishing.md` requires at least two people with Super admin or Content admin, so there is no single point of failure.
6. Add the email domain to the Page (the help page above) so team members can verify their association.
7. Tell me the final Page URL. I will then update `src/lib/socialLinks.ts` (the footer reads it), fill the `owner` column in the schedule CSV, and refresh the Notion pages.

## Ready-to-paste Page fields
Taken from the site's About page (`src/pages/About.tsx`) so the Page matches what the site already says.

| Field | Value |
|---|---|
| Name | MyPrivacyTOOL |
| Public URL (slug) | `myprivacytool` so the Page is `linkedin.com/company/myprivacytool`. LinkedIn may suggest a variant if it is taken; keep this exact slug if possible, because `socialLinks.ts` already assumes it |
| Website | https://www.myprivacytool.io |
| Industry | Computer and Network Security (a reasonable fit for a privacy tool; the owner can choose Software Development instead) |
| Organization size | 1 employee (or 2-10 if you count contractors; owner's call) |
| Organization type | Privately held |
| Location | Hong Kong |
| Tagline (LinkedIn limit is 120 characters; this is 87) | See and control your digital shadow. Privacy tools built in Hong Kong for Asia-Pacific. |

**About / description** (paste as is; edit freely):

```
MyPrivacyTOOL shows you your digital shadow: the signals your device and browser reveal to the websites you visit. We turn them into a visual map of Privacy Hexagons and a risk score, and point you to practical steps and opt-out guides.

We believe you should be able to see that information plainly, understand what it means, and decide what to do about it.

We are based in Hong Kong and start in the region we know and work in. Most consumer privacy tools are built around US and European rules; people across Asia-Pacific live under a patchwork of different laws, such as Hong Kong's PDPO and Singapore's PDPA, and have far fewer tools built with them in mind.

Run a free scan at www.myprivacytool.io.
```

**Specialties** (optional): privacy, personal data, data brokers, digital footprint, Asia-Pacific privacy law.

## Assets (a design task, not something I can finish)
- **Logo:** LinkedIn wants a square image (at least 300 x 300 px; check LinkedIn's current guidance when uploading). The repo has no square logo: the closest is `src/assets/logo-full.png` at 666 x 375, which would be cropped or letterboxed. Someone needs to provide or approve a square version.
- **Cover banner:** LinkedIn's recommended banner is a very wide image (about 1128 x 191 px; check current guidance). The repo has none. `public/og-image.jpg` is 1200 x 630 and the wrong shape.
- Use the Brand Bible v2 palette and logo as already used on the site.

## First posts, after the Page exists
- The launch copy and a draft schedule are in `docs/gtm/mpc-117/social-posts.md` and `social-schedule.csv`.
- Do not post until a second person has reviewed the copy and the Page has two admins.

## Rollback
Delete this file. Nothing else changed. A LinkedIn Page can be deleted from its **Admin tools > Deactivate page**; nothing in the repo depends on it until `socialLinks.ts` is changed.
