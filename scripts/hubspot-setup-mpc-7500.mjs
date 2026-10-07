// MPC-7500: one-time setup of the HubSpot contact properties the mpt-leads Worker writes.
// Usage: HUBSPOT_TOKEN=<private-app token with crm.schemas.contacts.write> node scripts/hubspot-setup-mpc-7500.mjs
// Idempotent: a property that already exists (HTTP 409) is reported and skipped. Prints no secrets.
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

export const PROPERTIES = [
  { name: 'mpt_lead_score', label: 'MPT Lead Score', type: 'number', fieldType: 'number', description: 'MPC-7500 readiness score 0-100 (High Priority > 80).' },
  { name: 'mpt_lead_tier', label: 'MPT Lead Tier', type: 'string', fieldType: 'text', description: 'High / Medium / Low' },
  { name: 'mpt_lead_segment', label: 'MPT Lead Segment', type: 'string', fieldType: 'text', description: 'B2B / B2C' },
  { name: 'mpt_lead_enrich_status', label: 'MPT Lead Enrich Status', type: 'string', fieldType: 'text', description: 'scored / pending' },
  { name: 'mpt_lead_scored_at', label: 'MPT Lead Scored At', type: 'string', fieldType: 'text', description: 'ISO timestamp of the last scoring run' },
];

export async function setup(token, fetchImpl = fetch) {
  const results = [];
  for (const p of PROPERTIES) {
    const res = await fetchImpl('https://api.hubapi.com/crm/v3/properties/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, groupName: 'contactinformation' }),
    });
    results.push({ name: p.name, status: res.status === 409 ? 'exists' : res.ok ? 'created' : `failed (${res.status})` });
  }
  return results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  if (!process.env.HUBSPOT_TOKEN) { console.error('Set HUBSPOT_TOKEN first.'); process.exit(2); }
  const results = await setup(process.env.HUBSPOT_TOKEN);
  for (const r of results) console.log(`${r.name}: ${r.status}`);
  process.exit(results.some((r) => r.status.startsWith('failed')) ? 1 : 0);
}
