// HubSpot daily collector (MPC-7379). Counts and aggregates only: no contact emails, names, phone numbers or any
// other personal data is ever stored in the payload, the logs or the error text. (The form-submissions endpoint returns
// submitted values; they pass through memory for counting only and are dropped.)
//
// Safety rails:
//  * Portal guard. Before any CRM read the collector asks HubSpot which portal the token belongs to and compares it
//    with HUBSPOT_PORTAL_ID (MPT = 246502821; other ventures' portals have been written to by mistake before).
//    A mismatch, or a portal ID that cannot be read, writes a status=error row and reads nothing else.
//  * Read-only. Auth is HUBSPOT_READONLY_TOKEN (a read-only private-app token), deliberately a different name from the
//    write-capable HUBSPOT_TOKEN / HUBSPOT_API_KEY used by other Workers. hubspotRead() refuses anything but GET and
//    the contact/deal search endpoints, whatever the token could do.
//  * Error text carries the endpoint label and HTTP status only, never a response body.
import { previousHkDay } from '../lib/hk.js';

export const HUBSPOT_PORTAL_ID = 246502821;
const API = 'https://api.hubapi.com';
const MAX_DEAL_PAGES = 50; // 100 deals per page; beyond this the pull is reported as an error, not silently truncated
const SEARCH_PATH = /^\/crm\/v3\/objects\/(contacts|deals)\/search$/;
const NO_STAGE = '(none)';
const MAX_FORM_PAGES = 20; // 50 submissions per page per form; beyond this the form count is reported as an error, not truncated

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// The only door to HubSpot. GET anywhere, POST only to the contact/deal search endpoints (a read, with a body).
export async function hubspotRead(env, method, path, label, body) {
  const m = String(method).toUpperCase();
  if (!(m === 'GET' || (m === 'POST' && SEARCH_PATH.test(path)))) throw new Error(`hubspot ${label}: refused non-read call`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: m,
      headers: { Authorization: `Bearer ${env.HUBSPOT_READONLY_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt === 0) { await sleep(Number(env.HUBSPOT_PAUSE_MS ?? 1000)); continue; }
    if (!res.ok) throw Object.assign(new Error(`hubspot ${label}: HTTP ${res.status}`), { status: res.status });
    return res.json();
  }
}

// Search with limit 1 and only hs_object_id requested: the response's `total` is all that is kept.
async function searchTotal(env, object, filters, label) {
  await sleep(Number(env.HUBSPOT_PAUSE_MS ?? 250)); // search API allows ~5 requests/second
  const out = await hubspotRead(env, 'POST', `/crm/v3/objects/${object}/search`, label, {
    filterGroups: [{ filters }], properties: ['hs_object_id'], limit: 1,
  });
  if (typeof out?.total !== 'number') throw new Error(`hubspot ${label}: no total in response`);
  return out.total;
}

async function collectContacts(env, { start, end }) {
  const total = await searchTotal(env, 'contacts', [{ propertyName: 'hs_object_id', operator: 'HAS_PROPERTY' }], 'contacts total');
  const createdOnDay = await searchTotal(env, 'contacts', [
    { propertyName: 'createdate', operator: 'GTE', value: String(start.getTime()) },
    { propertyName: 'createdate', operator: 'LT', value: String(end.getTime()) },
  ], 'contacts created');
  const prop = await hubspotRead(env, 'GET', '/crm/v3/properties/contacts/lifecyclestage', 'lifecycle options');
  const byStage = {};
  for (const opt of prop.options ?? []) {
    byStage[opt.value] = await searchTotal(env, 'contacts', [{ propertyName: 'lifecyclestage', operator: 'EQ', value: opt.value }], `lifecycle ${opt.value}`);
  }
  byStage[NO_STAGE] = await searchTotal(env, 'contacts', [{ propertyName: 'lifecyclestage', operator: 'NOT_HAS_PROPERTY' }], 'lifecycle none');
  return { total, created_on_day: createdOnDay, by_lifecycle_stage: byStage };
}

async function collectDeals(env) {
  const pipelines = await hubspotRead(env, 'GET', '/crm/v3/pipelines/deals', 'deal pipelines');
  const labels = {};
  for (const p of pipelines.results ?? []) for (const s of p.stages ?? []) labels[`${p.id}:${s.id}`] = { pipeline: p.label ?? null, stage: s.label ?? null };

  const groups = new Map();
  let count = 0; let amountSum = 0; let after;
  for (let page = 0; ; page++) {
    if (page >= MAX_DEAL_PAGES) throw new Error(`hubspot deals: more than ${MAX_DEAL_PAGES * 100} deals, not collected`);
    const qs = new URLSearchParams({ limit: '100', properties: 'dealstage,pipeline,amount' });
    if (after) qs.set('after', after);
    const out = await hubspotRead(env, 'GET', `/crm/v3/objects/deals?${qs}`, 'deals');
    for (const d of out.results ?? []) {
      const pipeline = d.properties?.pipeline ?? NO_STAGE;
      const stage = d.properties?.dealstage ?? NO_STAGE;
      const key = `${pipeline}:${stage}`;
      const amount = d.properties?.amount === undefined || d.properties?.amount === null || d.properties?.amount === '' ? null : Number(d.properties.amount);
      const g = groups.get(key) ?? { pipeline_id: pipeline, stage_id: stage, ...(labels[key] ?? { pipeline: null, stage: null }), count: 0, with_amount: 0, amount_sum: 0 };
      g.count += 1;
      if (Number.isFinite(amount)) { g.with_amount += 1; g.amount_sum += amount; amountSum += amount; }
      groups.set(key, g);
      count += 1;
    }
    after = out.paging?.next?.after;
    if (!after) break;
  }
  return { total: count, amount_sum: amountSum, by_stage: [...groups.values()] };
}

// Form submissions that landed in the window, counted across all forms. The submissions endpoint returns the submitted
// values (personal data): each page is read, only submittedAt is looked at, and nothing else is kept or logged.
// Needs scope `forms`; a 403 is reported by the caller as a scope warning, not an error.
async function collectForms(env, { start, end }) {
  await sleep(Number(env.HUBSPOT_PAUSE_MS ?? 250));
  const list = await hubspotRead(env, 'GET', '/marketing/v3/forms/?limit=100', 'forms list');
  let submissions = 0; let formsCounted = 0;
  for (const form of list.results ?? []) {
    if (!/^[\w-]+$/.test(String(form.id))) continue;
    formsCounted += 1;
    let after;
    for (let page = 0; ; page++) {
      if (page >= MAX_FORM_PAGES) throw new Error(`hubspot form submissions: more than ${MAX_FORM_PAGES * 50} submissions on one form, not collected`);
      await sleep(Number(env.HUBSPOT_PAUSE_MS ?? 250));
      const qs = new URLSearchParams({ limit: '50' });
      if (after) qs.set('after', after);
      const out = await hubspotRead(env, 'GET', `/form-integrations/v1/submissions/forms/${form.id}?${qs}`, 'form submissions');
      let reachedOlder = false;
      for (const r of out.results ?? []) { // newest first
        const t = Number(r.submittedAt);
        if (t >= end.getTime()) continue;
        if (t < start.getTime()) { reachedOlder = true; break; }
        submissions += 1;
      }
      after = out.paging?.next?.after;
      if (reachedOlder || !after) break;
    }
  }
  return { submissions_on_day: submissions, forms_counted: formsCounted };
}

// Marketing email engagement for the window (aggregate counters only). All null when no marketing email went out.
// Needs scope `content` (marketing email statistics); a 403 is reported by the caller as a scope warning.
async function collectEmail(env, { start, end }) {
  await sleep(Number(env.HUBSPOT_PAUSE_MS ?? 250));
  const qs = new URLSearchParams({ startTimestamp: start.toISOString(), endTimestamp: end.toISOString() });
  const out = await hubspotRead(env, 'GET', `/marketing/v3/emails/statistics/list?${qs}`, 'email statistics');
  const c = out?.aggregate?.counters;
  const num = (k) => (c && Number.isFinite(Number(c[k])) ? Number(c[k]) : null);
  if (!c || !num('sent')) return { sent: null, delivered: null, opens: null, clicks: null, bounces: null, unsubscribes: null };
  return { sent: num('sent'), delivered: num('delivered'), opens: num('open'), clicks: num('click'), bounces: num('bounce'), unsubscribes: num('unsubscribed') };
}

// Missing scope (403) => null + warning, so a token without the extra scopes still yields a healthy row.
async function optional(name, scope, payload, failures, fn) {
  try { payload[name] = await fn(); } catch (e) {
    payload[name] = null;
    if (e.status === 403) { (payload.scope_warnings ??= []).push(`${name}: token lacks scope ${scope}`); console.warn(`hubspot ${name}: token lacks scope ${scope}, skipped`); } else failures.push(e.message);
  }
}

export default {
  source: 'hubspot',
  report: 'portal_daily',
  async collect(env, now = new Date()) {
    // "That day" = the Hong Kong day before this run; period_start/end are that day's instants.
    const win = previousHkDay(now);
    const period = { period_start: win.start.toISOString(), period_end: win.end.toISOString() };
    const blank = { day: win.day, portal_id: HUBSPOT_PORTAL_ID, contacts: null, deals: null, forms: null, email: null };

    if (!env.HUBSPOT_READONLY_TOKEN) return { ...period, payload: { ...blank, guard: { ok: false } }, error: 'HUBSPOT_READONLY_TOKEN not set' };

    // Portal guard: nothing else is read until the token is proven to belong to MPT's portal.
    let seen = null;
    try {
      const info = await hubspotRead(env, 'GET', '/account-info/v3/details', 'account details');
      seen = Number(info?.portalId);
    } catch (e) {
      return { ...period, payload: { ...blank, guard: { ok: false, portal_id_seen: null } }, error: `portal guard: portal ID could not be read (${e.message}); nothing collected` };
    }
    if (seen !== HUBSPOT_PORTAL_ID) {
      return {
        ...period, payload: { ...blank, guard: { ok: false, portal_id_seen: Number.isFinite(seen) ? seen : null } },
        error: `portal guard: token belongs to portal ${Number.isFinite(seen) ? seen : 'unknown'}, expected ${HUBSPOT_PORTAL_ID}; nothing collected`,
      };
    }

    const payload = { ...blank, guard: { ok: true, portal_id_seen: seen }, as_of: now.toISOString() };
    const failures = [];
    try { payload.contacts = await collectContacts(env, win); } catch (e) { failures.push(e.message); }
    try { payload.deals = await collectDeals(env); } catch (e) { failures.push(e.message); }
    await optional('forms', 'forms', payload, failures, () => collectForms(env, win));
    await optional('email', 'content', payload, failures, () => collectEmail(env, win));
    return { ...period, payload, error: failures.length ? failures.join('; ') : null };
  },
};
