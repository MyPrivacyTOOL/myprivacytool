// Pushes a finished scan to HubSpot as a note on the contact (an activity on its timeline). Best effort: never throws.
// Counts only; no breach names or other detail leave Supabase.
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { rcx } from './recipients.js';
const API = 'https://api.hubapi.com';
const CONTACT_TO_NOTE = 202;   // HubSpot-defined association: note -> contact

export async function pushScanActivity(env, { email, scanId, score, riskLevel, signalsFound, breachStatus, breachCount }, fetchImpl = undefined, rctx = undefined) {
  if (!env.HUBSPOT_TOKEN) return { skipped: 'no HUBSPOT_TOKEN' };
  const ctx = rcx(env, fetchImpl, rctx);
  const headers = { Authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
  try {
    const found = await callRecipient('hubspot', { url: `${API}/crm/v3/objects/contacts/search`, sent: ['email'], init: {
      method: 'POST', headers,
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], limit: 1 }),
    } }, ctx);
    if (!found.ok) return { failed: `contact search ${found.status}` };
    const contactId = (await found.json()).results?.[0]?.id;
    if (!contactId) return { skipped: 'contact not found' };
    const breaches = breachStatus === 'checked' ? `${breachCount} breach(es) found` : 'breaches not checked';
    const body = `MyPrivacyTOOL scan report sent (scan ${scanId}). ${score == null ? 'No score (partial scan)' : `Privacy score ${score}/100, risk ${riskLevel}`}; ${signalsFound} signal(s); ${breaches}.`;
    // The note carries the score and counts for the contact found by email: the address itself is not in the body, the scan result is.
    const note = await callRecipient('hubspot', { url: `${API}/crm/v3/objects/notes`, sent: ['scan_result'], init: {
      method: 'POST', headers,
      body: JSON.stringify({
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
        associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: CONTACT_TO_NOTE }] }],
      }),
    } }, ctx);
    return note.ok ? { pushed: true } : { failed: `note ${note.status}` };
  } catch (e) {
    return { failed: String(e).replace(/\S+@\S+/g, '[email]').slice(0, 200) };
  }
}

// Marks the contact as unsubscribed from all email in HubSpot (hs_email_optout), so no HubSpot-sent marketing email reaches them either.
// Best effort: never throws, and never prints the address. A contact HubSpot does not know is fine (nothing to opt out).
export async function pushEmailOptOut(env, { email }, fetchImpl = undefined, rctx = undefined) {
  if (!env.HUBSPOT_TOKEN) return { skipped: 'no HUBSPOT_TOKEN' };
  const ctx = rcx(env, fetchImpl, rctx);
  const headers = { Authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
  try {
    const found = await callRecipient('hubspot', { url: `${API}/crm/v3/objects/contacts/search`, sent: ['email'], init: {
      method: 'POST', headers,
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], limit: 1 }),
    } }, ctx);
    if (!found.ok) return { failed: `contact search ${found.status}` };
    const contactId = (await found.json()).results?.[0]?.id;
    if (!contactId) return { skipped: 'contact not found' };
    const patched = await callRecipient('hubspot', { url: `${API}/crm/v3/objects/contacts/${contactId}`, sent: [], init: {
      method: 'PATCH', headers, body: JSON.stringify({ properties: { hs_email_optout: 'true' } }),
    } }, ctx);
    return patched.ok ? { optedOut: true } : { failed: `contact update ${patched.status}` };
  } catch (e) {
    return { failed: String(e).replace(/\S+@\S+/g, '[email]').slice(0, 200) };
  }
}
