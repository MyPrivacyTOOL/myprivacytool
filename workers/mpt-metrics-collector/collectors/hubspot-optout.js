// MPC-7555: HubSpot -> THE opt-out record. Our unsubscribe already pushes hs_email_optout=true INTO HubSpot (scan-report lib/hubspot.js). This is the other
// direction: a contact who unsubscribes through a HubSpot-sent email (its own footer link) is recorded in public.email_suppressions, so every sender of ours
// stops too, whichever door the person used. Daily, read-only on HubSpot (hubspotRead refuses anything but contact/deal searches), idempotent on the database.
// Only SHA-256 hashes are written; the payload and the error text carry counts, never an address.
import { hubspotRead, HUBSPOT_PORTAL_ID } from './hubspot.js';

const MAX_PAGES = 10;   // 100 contacts per page; Workers free plan allows 50 subrequests per run, the other collectors need the rest
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const hashEmail = async (email) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email).trim().toLowerCase())));

async function optedOutHashes(env) {
  const hashes = new Set();
  let after;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`hubspot-optout: more than ${MAX_PAGES * 100} opted-out contacts, not all recorded`);
    const out = await hubspotRead(env, 'POST', '/crm/v3/objects/contacts/search', 'opted-out contacts', {
      filterGroups: [{ filters: [{ propertyName: 'hs_email_optout', operator: 'EQ', value: 'true' }] }], properties: ['email'], limit: 100, ...(after ? { after } : {}),
    });
    for (const r of out.results ?? []) if (r.properties?.email) hashes.add(await hashEmail(r.properties.email));
    after = out.paging?.next?.after;
    if (!after) break;
  }
  return hashes;
}

export default {
  source: 'supabase',
  report: 'hubspot_optout_sync',
  async collect(env) {
    const hashes = await optedOutHashes(env);
    let recorded = 0;
    if (hashes.size) {
      // ignore-duplicates: an address already recorded is left alone; return=representation tells us how many rows were genuinely new.
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/email_suppressions?on_conflict=email_hash`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify([...hashes].map((email_hash) => ({ email_hash, source: 'hubspot_optout' }))),
      });
      if (!res.ok) throw new Error(`hubspot-optout: suppression write failed: HTTP ${res.status}`);
      recorded = (await res.json()).length;
    }
    return { payload: { portal: HUBSPOT_PORTAL_ID, hubspot_opted_out: hashes.size, newly_recorded: recorded } };
  },
};
