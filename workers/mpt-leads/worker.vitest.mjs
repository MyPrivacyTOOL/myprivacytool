// @vitest-environment node
// MPC-7300: Vitest unit tests for the mpt-leads Worker (all outbound calls stubbed; no network, no secrets).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './worker.js';

const ORIGIN = 'https://myprivacytool.io';
const env = { NOTION_TOKEN: 'n', LEADS_DB_ID: 'abc-def', SUPABASE_SERVICE_ROLE_KEY: 'k', HUBSPOT_TOKEN: 'h', RESEND_API_KEY: 'r', SLACK_BOT_TOKEN: 's' };

let calls;
let handlers;
const ok = (body = {}, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

beforeEach(() => {
  calls = [];
  handlers = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
    for (const [needle, fn] of Object.entries(handlers)) if (u.includes(needle)) return fn(u, opts);
    if (u.includes('/query')) return ok({ results: [{}, {}], has_more: false });
    return ok({});
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function post(body, { headers = {}, e = env, raw } = {}) {
  const waits = [];
  const req = new Request('https://x/webhook/leads', {
    method: 'POST',
    headers: raw ? headers : { 'content-type': 'application/json', Origin: ORIGIN, ...headers },
    body: raw ?? JSON.stringify(body),
  });
  const res = await worker.fetch(req, e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const to = (needle) => calls.filter((c) => c.url.includes(needle));

describe('routing and CORS', () => {
  it('answers OPTIONS preflight with 204 and CORS headers', async () => {
    const res = await worker.fetch(new Request('https://x/', { method: 'OPTIONS', headers: { Origin: 'https://www.myprivacytool.io' } }), env, {});
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.myprivacytool.io');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
  it('falls back to the primary origin for unknown origins', async () => {
    const res = await worker.fetch(new Request('https://x/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env, {});
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
  it('404s non-POST methods', async () => {
    const res = await worker.fetch(new Request('https://x/', { method: 'GET' }), env, {});
    expect(res.status).toBe(404);
  });
});

describe('input handling', () => {
  it('rejects a missing email with 400', async () => {
    const res = await post({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Email required');
  });
  it('short-circuits watchdog health checks without saving', async () => {
    for (const email of ['x@healthcheck.io', 'watchdog@healthcheck.io']) {
      const res = await post({ email });
      expect((await res.json()).note).toBe('healthcheck');
    }
    expect(calls).toHaveLength(0);
  });
  it('accepts multipart/form-data signups (the landing-page form path)', async () => {
    const fd = new FormData();
    fd.set('email', 'form@user.co'); fd.set('name', 'Form User'); fd.set('phone', '+1 555 0100');
    fd.set('utm_source', 'reddit'); fd.set('consent', 'on'); fd.set('consent_source', 'landing');
    const waits = [];
    const res = await worker.fetch(new Request('https://x/', { method: 'POST', body: fd }), env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(res.status).toBe(200);
    const props = JSON.parse(to('api.hubapi.com')[0].body).properties;
    expect(props).toMatchObject({ email: 'form@user.co', firstname: 'Form', lastname: 'User', phone: '+1 555 0100', consent_source: 'landing' });
    const notion = JSON.parse(to('api.notion.com/v1/pages')[0].body).properties;
    expect(notion['UTM Source'].rich_text[0].text.content).toBe('reddit');
    expect(notion.Phone.phone_number).toBe('+1 555 0100');
  });
  it('returns 500 with the error message when the body is not valid JSON', async () => {
    const res = await post(null, { raw: '{not json', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(500);
    expect(typeof (await res.json()).error).toBe('string');
  });
});

describe('Notion + enrichment', () => {
  it('writes the lead to Notion with technical metadata from the request', async () => {
    const res = await post({ email: 'a@b.co', name: 'Ann Lee', referrer: 'https://news.ycombinator.com/x' }, {
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1' },
    });
    expect(res.status).toBe(200);
    const p = JSON.parse(to('api.notion.com/v1/pages')[0].body).properties;
    expect(p.Name.title[0].text.content).toBe('Ann Lee');
    expect(p['IP Address'].rich_text[0].text.content).toBe('1.2.3.4');
    expect(p.Device.select.name).toBe('Mobile');
    expect(p.OS.rich_text[0].text.content).toBe('iOS');
    expect(p.Browser.rich_text[0].text.content).toBe('Safari');
    expect(p.Referrer.url).toBe('https://news.ycombinator.com/x');
  });
  it('uses the email as the Notion title when no name is given', async () => {
    await post({ email: 'only@email.co' });
    expect(JSON.parse(to('api.notion.com/v1/pages')[0].body).properties.Name.title[0].text.content).toBe('only@email.co');
  });
  it('returns 500 and does not notify when Notion rejects the write', async () => {
    handlers['api.notion.com/v1/pages'] = () => ({ ok: false, status: 500, text: async () => 'notion down' });
    const res = await post({ email: 'a@b.co' });
    expect(res.status).toBe(500);
    expect(to('slack.com')).toHaveLength(0);
  });
  it('pages through Notion to count leads and reports it to Slack', async () => {
    let n = 0;
    handlers['/query'] = () => ok(++n === 1 ? { results: [{}], has_more: false } : n === 2 ? { results: [{}, {}], has_more: true, next_cursor: 'c2' } : { results: [{}], has_more: false });
    await post({ email: 'a@b.co', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', utm_content: 'ad1' });
    const text = JSON.parse(to('slack.com')[0].body).text;
    expect(text).toContain('Total Leads: 3');
    expect(text).toContain('Google Paid Ad');
    expect(text).toContain('Campaign spring');
    expect(text).toContain('Content: ad1');
  });
  it('tolerates a failing lead count (shows "?")', async () => {
    handlers['/query'] = () => { throw new Error('boom'); };
    const res = await post({ email: 'a@b.co' });
    expect(res.status).toBe(200);
    expect(JSON.parse(to('slack.com')[0].body).text).toContain('Total Leads: ?');
  });
  it('skips Slack when no bot token and defaults the channel when set', async () => {
    await post({ email: 'a@b.co' }, { e: { ...env, SLACK_BOT_TOKEN: undefined } });
    expect(to('slack.com')).toHaveLength(0);
    calls.length = 0;
    await post({ email: 'a@b.co' }, { e: { ...env, SLACK_CHANNEL_ID: 'CUSTOM' } });
    expect(JSON.parse(to('slack.com')[0].body).channel).toBe('CUSTOM');
  });
});

describe.each([
  [{ utm_source: 'reddit' }, 'Reddit'], [{ utm_source: 'x.com' }, 'Twitter / X'], [{ utm_source: 'linkedin' }, 'LinkedIn'],
  [{ utm_source: 'fb' }, 'Facebook'], [{ utm_source: 'ig' }, 'Instagram'], [{ utm_medium: 'email' }, 'Email'],
  [{ utm_medium: 'organic' }, 'Google Organic'], [{ utm_source: 'partner', utm_medium: 'banner' }, 'partner / banner'],
  [{ referrer: 'https://www.google.com/' }, 'Google (no UTM)'], [{ referrer: 'https://reddit.com/r/privacy' }, 'Reddit (no UTM)'],
  [{ referrer: 'https://t.co/abc' }, 'Twitter (no UTM)'], [{ referrer: 'https://www.linkedin.com/' }, 'LinkedIn (no UTM)'],
  [{ referrer: 'https://example.org/p' }, 'example.org'], [{ referrer: 'not a url' }, 'Direct / Unknown'], [{}, 'Direct / Unknown'],
])('traffic source inference %j', (params, expected) => {
  it(`labels the lead "${expected}"`, async () => {
    await post({ email: 'a@b.co', ...params });
    expect(JSON.parse(to('slack.com')[0].body).text).toContain(expected);
  });
});

describe.each([
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120', 'Edge', 'Windows', 'Desktop'],
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 OPR/100', 'Opera', 'Windows', 'Desktop'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Chrome/120', 'Chrome', 'macOS', 'Desktop'],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:120) Firefox/120', 'Firefox', 'Linux', 'Desktop'],
  ['Mozilla/5.0 (iPad; CPU OS 17) Safari/604.1', 'Safari', 'iOS', 'Tablet'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile', 'Chrome', 'Android', 'Mobile'],
  ['Mozilla/5.0 (Linux; Android 13; SM-T) Chrome/120', 'Chrome', 'Android', 'Desktop'],
  ['Mozilla/5.0 (Linux; Android 13) Tablet Chrome/120', 'Chrome', 'Android', 'Tablet'],
  ['Mozilla/5.0 (X11; CrOS x86_64) Chrome/120', 'Chrome', 'ChromeOS', 'Desktop'],
  ['Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0)', 'IE', 'Windows', 'Desktop'],
  ['curl/8.0', 'Other', 'Other', 'Desktop'],
])('user agent %s', (ua, browser, os, device) => {
  it('is parsed', async () => {
    await post({ email: 'a@b.co' }, { headers: { 'user-agent': ua } });
    const p = JSON.parse(to('api.notion.com/v1/pages')[0].body).properties;
    expect([p.Browser?.rich_text[0].text.content, p.OS?.rich_text[0].text.content, p.Device.select.name]).toEqual([browser, os, device]);
  });
});

describe('HubSpot sync', () => {
  it('PATCHes the existing contact when HubSpot answers 409', async () => {
    handlers['api.hubapi.com/crm/v3/objects/contacts'] = (_u, o) =>
      o.method === 'POST' ? ok({ message: 'Contact already exists. Existing ID: 4242' }, 409) : ok({});
    await post({ email: 'dup@b.co', name: 'Dup' });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.url).toMatch(/contacts\/4242$/);
  });
  it('does nothing further on a 409 without an ID, and survives network errors', async () => {
    handlers['api.hubapi.com'] = () => ok({ message: 'nope' }, 409);
    expect((await post({ email: 'dup@b.co' })).status).toBe(200);
    handlers['api.hubapi.com'] = () => { throw new Error('offline'); };
    expect((await post({ email: 'dup@b.co' })).status).toBe(200);
  });
  it('skips HubSpot without a token', async () => {
    await post({ email: 'a@b.co' }, { e: { ...env, HUBSPOT_TOKEN: undefined } });
    expect(to('hubapi')).toHaveLength(0);
  });
});

describe('confirmation email', () => {
  it('sends via Resend with a personalised greeting', async () => {
    await post({ email: 'a@b.co', name: 'Zed Q' });
    const body = JSON.parse(to('api.resend.com')[0].body);
    expect(body.to).toEqual(['a@b.co']);
    expect(body.subject).toContain('Zed');
    expect(body.html).toContain('Hi Zed');
  });
  it('greets "there" with no name', async () => {
    await post({ email: 'a@b.co' });
    expect(JSON.parse(to('api.resend.com')[0].body).html).toContain('Hi there');
  });
  it('is skipped when the scan-report Worker owns confirmations, or no key is set', async () => {
    await post({ email: 'a@b.co' }, { e: { ...env, CONFIRMATION_OWNER: 'scan-report' } });
    await post({ email: 'a@b.co' }, { e: { ...env, RESEND_API_KEY: undefined } });
    expect(to('api.resend.com')).toHaveLength(0);
  });
});

describe('Supabase engagement + baseline', () => {
  it('uses SUPABASE_URL when provided', async () => {
    await post({ email: 'a@b.co', riskScore: 10 }, { e: { ...env, SUPABASE_URL: 'https://custom.supabase.co' } });
    expect(to('custom.supabase.co/rest/v1/mpt_user_engagement')).toHaveLength(1);
  });
  it('survives a thrown Supabase error', async () => {
    handlers['mpt_user_engagement'] = () => { throw new Error('dns'); };
    expect((await post({ email: 'a@b.co' })).status).toBe(200);
  });
  it('returns the stored baseline and delta on a re-scan', async () => {
    handlers['mpt_score_baselines'] = (_u, o) => (o?.method === 'POST' ? ok([], 201) : ok([{ overall_score: 60, created_at: '2026-10-01T00:00:00Z' }]));
    const json = await (await post({ email: 'a@b.co', riskScore: 45.4, categoryScores: [1, 2] })).json();
    expect(json.baseline).toMatchObject({ is_first: false, overall_score: 60, delta: -15 });
  });
  it('drops the baseline when Supabase insert/select fails or returns nothing', async () => {
    handlers['mpt_score_baselines'] = () => ({ ok: false, status: 500, text: async () => 'x' });
    expect((await (await post({ email: 'a@b.co', riskScore: 40 })).json()).baseline).toBeUndefined();
    handlers['mpt_score_baselines'] = (_u, o) => (o?.method === 'POST' ? ok([], 201) : { ok: false, status: 500 });
    expect((await (await post({ email: 'a@b.co', riskScore: 40 })).json()).baseline).toBeUndefined();
    handlers['mpt_score_baselines'] = (_u, o) => (o?.method === 'POST' ? ok([], 201) : ok([]));
    expect((await (await post({ email: 'a@b.co', riskScore: 40 })).json()).baseline).toBeUndefined();
    handlers['mpt_score_baselines'] = () => { throw new Error('net'); };
    expect((await post({ email: 'a@b.co', riskScore: 40 })).status).toBe(200);
  });
  it('rejects non-numeric and blank scores', async () => {
    for (const riskScore of ['abc', '', -1]) {
      calls.length = 0;
      await post({ email: 'a@b.co', riskScore });
      expect(to('mpt_score_baselines')).toHaveLength(0);
    }
  });
});

describe('consent', () => {
  const props = () => JSON.parse(to('api.hubapi.com')[0].body).properties;
  it.each([[true], ['true'], ['on']])('treats %j as explicit consent', async (consent) => {
    await post({ email: 'a@b.co', consent });
    expect(props().consent_source).toBe('landing_page');
  });
  it.each([[false], ['false'], [undefined], ['yes']])('does not treat %j as consent', async (consent) => {
    await post({ email: 'a@b.co', consent });
    expect(props()).not.toHaveProperty('consent_given_at');
  });
});
