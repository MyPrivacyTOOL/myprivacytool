// @vitest-environment node
// MPC-7500: enrichment + scoring + alert tests (all outbound calls stubbed).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './worker.js';
import { scoreLead, tierFor, normaliseHunter, employeeCount, enrichAndScore } from './lead-scoring.js';

const hunterBody = (o = {}) => ({ data: { person: { employment: { title: 'Chief Information Security Officer', seniority: 'executive', role: 'security', ...o.job }, geo: { countryCode: 'US' } }, company: { name: 'Acme', metrics: { employees: '1001-5000' } } } });
const env = { NOTION_TOKEN: 'n', LEADS_DB_ID: 'abc-def', HUBSPOT_TOKEN: 'h', SLACK_BOT_TOKEN: 's', HUNTER_API_KEY: 'hk' };
let calls, handlers;
const res = (body = {}, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
beforeEach(() => {
  calls = []; handlers = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const u = String(url); calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    for (const [k, fn] of Object.entries(handlers)) if (u.includes(k)) return fn(u, opts);
    if (u.includes('/query')) return res({ results: [], has_more: false });
    return res({});
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const to = (n) => calls.filter((c) => c.url.includes(n));
async function post(body, e = env) {
  const waits = [];
  const r = await worker.fetch(new Request('https://x/', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify(body) }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits); return r;
}

describe('scoring', () => {
  it('tiers: >80 High, 50-80 Medium, <50 Low', () => {
    expect(tierFor(81)).toBe('High'); expect(tierFor(80)).toBe('Medium'); expect(tierFor(50)).toBe('Medium'); expect(tierFor(49)).toBe('Low');
  });
  it('senior security exec at a large US company is High Priority', () => {
    const r = scoreLead({ email: 'ciso@acme.com', enrichment: normaliseHunter(hunterBody()), country: '' });
    expect(r.score).toBeGreaterThan(80); expect(r.tier).toBe('High'); expect(r.b2b).toBe(true);
  });
  it('free-mail is B2C and can never be High Priority', () => {
    const r = scoreLead({ email: 'x@gmail.com', enrichment: normaliseHunter(hunterBody()), country: 'US' });
    expect(r.b2b).toBe(false); expect(r.score).toBeLessThanOrEqual(25); expect(r.tier).toBe('Low');
  });
  it('geo: tier1 > EU > other > unknown', () => {
    const g = (c) => scoreLead({ email: 'a@acme.com', enrichment: null, country: c }).parts.geo;
    expect(g('US')).toBeGreaterThan(g('PL')); expect(g('PL')).toBeGreaterThan(g('ZZ')); expect(g('ZZ')).toBeGreaterThan(g(''));
  });
  it('parses Hunter employee ranges', () => { expect(employeeCount('1001-5000')).toBe(1001); expect(employeeCount('10,001+')).toBe(10001); expect(employeeCount(undefined)).toBe(0); });
  it('Hunter 404 scores on domain/geo and is final; 500 is pending', async () => {
    handlers['hunter.io'] = () => res({}, 404);
    let r = await enrichAndScore(env, 'a@acme.com', 'US'); expect(r.props.mpt_lead_enrich_status).toBe('scored');
    handlers['hunter.io'] = () => res({}, 500);
    r = await enrichAndScore(env, 'a@acme.com', 'US'); expect(r.props.mpt_lead_enrich_status).toBe('pending');
  });
  it('free-mail never calls Hunter (no credits spent on B2C)', async () => {
    await enrichAndScore(env, 'a@gmail.com', 'US'); expect(to('hunter.io')).toHaveLength(0);
  });
});

describe('worker integration', () => {
  it('sends mpt_lead_score and enrichment to HubSpot and alerts Slack for High Priority', async () => {
    handlers['hunter.io'] = () => res(hunterBody());
    expect((await post({ email: 'ciso@acme.com', name: 'C I' })).status).toBe(200);
    const props = JSON.parse(to('api.hubapi.com/crm/v3/objects/contacts')[0].body).properties;
    expect(Number(props.mpt_lead_score)).toBeGreaterThan(80);
    expect(props).toMatchObject({ mpt_lead_tier: 'High', mpt_lead_segment: 'B2B', mpt_lead_enrich_status: 'scored', jobtitle: 'Chief Information Security Officer', company: 'Acme' });
    expect(to('slack.com').some((c) => JSON.parse(c.body).text.includes('High Priority'))).toBe(true);
  });
  it('Hunter outage still creates the contact (status pending) and sends no alert', async () => {
    handlers['hunter.io'] = () => res({}, 500);
    expect((await post({ email: 'a@acme.com' })).status).toBe(200);
    const props = JSON.parse(to('api.hubapi.com/crm/v3/objects/contacts')[0].body).properties;
    expect(props.mpt_lead_enrich_status).toBe('pending');
    expect(to('slack.com').filter((c) => JSON.parse(c.body).text.includes('High Priority'))).toHaveLength(0);
  });
  it('HubSpot 400 for missing mpt_lead_* properties retries the contact write without them', async () => {
    handlers['hunter.io'] = () => res(hunterBody());
    let n = 0;
    handlers['api.hubapi.com/crm/v3/objects/contacts'] = (u, o) => (++n === 1 ? new Response(JSON.stringify({ message: 'Property "mpt_lead_score" does not exist' }), { status: 400 }) : res({}));
    await post({ email: 'ciso@acme.com' });
    const writes = to('api.hubapi.com/crm/v3/objects/contacts');
    expect(writes).toHaveLength(2);
    expect(Object.keys(JSON.parse(writes[1].body).properties).some((k) => k.startsWith('mpt_lead_'))).toBe(false);
    expect(JSON.parse(writes[1].body).properties.email).toBe('ciso@acme.com');
  });
  it('works unchanged without HUNTER_API_KEY', async () => {
    const { HUNTER_API_KEY, ...noKey } = env;
    expect((await post({ email: 'a@acme.com' }, noKey)).status).toBe(200);
    expect(to('hunter.io')).toHaveLength(0);
    expect(JSON.parse(to('api.hubapi.com/crm/v3/objects/contacts')[0].body).properties.mpt_lead_score).toBeDefined();
  });
  it('cron sweep re-enriches pending contacts and PATCHes the score', async () => {
    handlers['contacts/search'] = () => res({ results: [{ id: '42', properties: { email: 'ciso@acme.com', firstname: 'C' } }] });
    handlers['hunter.io'] = () => res(hunterBody());
    const waits = [];
    await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/contacts/42'));
    expect(JSON.parse(patch.body).properties.mpt_lead_enrich_status).toBe('scored');
  });
  it('cron sweep also picks up unscored enterprise-demo contacts, and works without HUNTER_API_KEY', async () => {
    handlers['contacts/search'] = () => res({ results: [{ id: '77', properties: { email: 'someone@gmail.com', firstname: 'S' } }] });
    const { HUNTER_API_KEY, ...noKey } = env;
    const waits = [];
    await worker.scheduled({}, noKey, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    const search = JSON.parse(to('contacts/search')[0].body);
    expect(search.filterGroups).toHaveLength(2);
    expect(search.filterGroups[1].filters).toContainEqual({ propertyName: 'source_tag', operator: 'EQ', value: 'enterprise-demo' });
    expect(search.filterGroups[1].filters).toContainEqual({ propertyName: 'mpt_lead_enrich_status', operator: 'NOT_HAS_PROPERTY' });
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/contacts/77'));
    expect(JSON.parse(patch.body).properties).toMatchObject({ mpt_lead_segment: 'B2C', mpt_lead_enrich_status: 'scored' });
    expect(to('hunter.io')).toHaveLength(0);
  });
});
