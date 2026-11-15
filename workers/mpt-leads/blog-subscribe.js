// MPC-10616: the /blog "Privacy Check" newsletter form. Own route (POST /blog-subscribe) on the existing lead Worker, so there is ONE HubSpot
// write path (HUBSPOT_TOKEN, portal 246502821). It creates the contact, or updates it when the email already exists (HubSpot answers 409),
// so a repeat submit never makes a second contact. It writes nothing else: no Notion row, no Slack post, no scan confirmation email.
import { callRecipient } from '../../shared/recipients/outbound.ts';
import { workerRecipientContext } from '../../shared/recipients/worker-ctx.ts';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const CONTACTS = 'https://api.hubapi.com/crm/v3/objects/contacts';

export async function blogSubscribe(env, input) {
  if (!input || typeof input !== 'object') return { status: 400, body: { error: 'Invalid request' } };
  const email = String(input.email ?? '').trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) return { status: 400, body: { error: 'Email required', message: 'Please enter a valid email address.' } };
  const consented = input.consent === true || input.consent === 'true' || input.consent === 'on';
  if (!consented) return { status: 400, body: { error: 'Consent required', message: 'Please tick the box so we may email you the newsletter.' } };
  if (!env.HUBSPOT_TOKEN) return { status: 503, body: { error: 'Not configured' } };

  // The path is the page the form sits on, never a free-form string: letters, digits and / - _ only.
  const path = String(input.path ?? '/blog').replace(/[^a-z0-9/_-]/gi, '').slice(0, 120) || '/blog';
  const props = {
    email,
    blog_source: 'true',
    blog_source_path: path,
    consent_given_at: new Date().toISOString().slice(0, 10),   // HubSpot date property: YYYY-MM-DD (UTC)
    consent_source: 'blog_newsletter',
  };
  const headers = { Authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
  const rctx = workerRecipientContext(env);
  try {
    let r = await callRecipient('hubspot', { url: CONTACTS, init: { method: 'POST', headers, body: JSON.stringify({ properties: props }) }, sent: ['email'] }, rctx);
    let id;
    if (r.status === 409) {
      id = (await r.json().catch(() => ({})))?.message?.match(/ID: (\d+)/)?.[1];
      if (!id) return { status: 502, body: { error: 'Could not save' } };
      r = await callRecipient('hubspot', { url: `${CONTACTS}/${id}`, init: { method: 'PATCH', headers, body: JSON.stringify({ properties: props }) }, sent: ['email'] }, rctx);
    } else if (r.ok) {
      id = (await r.clone().json().catch(() => ({})))?.id;
    }
    if (!r.ok) { console.error('blog-subscribe HubSpot write failed:', r.status); return { status: 502, body: { error: 'Could not save' } }; }
    return { status: 200, body: { success: true, updated: Boolean(id) && r.status === 200 } };
  } catch (e) {
    console.error('blog-subscribe error:', String(e).slice(0, 200));
    return { status: 502, body: { error: 'Could not save' } };
  }
}
