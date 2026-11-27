// Minimal PostgREST client using the service_role key (tables have forced RLS and no policies).
// MPC-9885: every request goes through the recipient wrapper (key "supabase"). The client is generic, so each call declares the items its table holds.
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { rcx } from './recipients.js';

const DEFAULT_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';

// What a request to this table or function can carry. Unlisted tables get the common set. Declared in full, never trimmed to get a call through.
const BASE_ITEMS = ['email', 'ip', 'scan_result'];
const TABLE_ITEMS = { email_sends: [], leads: ['email', 'ip', 'utm', 'referrer'], web_scan_listing_checks: ['email', 'name', 'phone', 'city', 'country'] };
const itemsFor = (path) => TABLE_ITEMS[path.split('?')[0]] ?? BASE_ITEMS;

export function db(env, fetchImpl = undefined, rctx = undefined) {
  const ctx = rcx(env, fetchImpl, rctx);
  const base = `${env.SUPABASE_URL || DEFAULT_URL}/rest/v1`;
  const headers = (extra = {}) => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  });
  async function call(method, path, body, prefer) {
    const res = await callRecipient('supabase', {
      url: `${base}/${path}`, sent: itemsFor(path),
      init: { method, headers: headers(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body) },
    }, ctx);
    const text = await res.text();
    if (!res.ok) { const e = new Error(`supabase ${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
    return text ? JSON.parse(text) : null;
  }
  return {
    select: (path) => call('GET', path),
    insert: (table, row) => call('POST', table, row, 'return=representation').then((r) => (Array.isArray(r) ? r[0] : r)),
    insertMany: (table, rows) => (rows.length ? call('POST', table, rows, 'return=representation') : Promise.resolve([])),
    patch: (path, row) => call('PATCH', path, row, 'return=representation'),
    remove: (path) => call('DELETE', path, undefined, 'return=minimal'),
    rpc: (fn, args) => call('POST', `rpc/${fn}`, args),
  };
}
