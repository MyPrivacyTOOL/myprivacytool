// @vitest-environment node
// MPC-9887: POST/GET /api/consent, the server-side gate on POST /api/scan, the consent copied onto the saved scan, and the report job presenting the consent.
import { describe, it, expect } from 'vitest';
import worker, { handleScan, runReportJob } from './index.js';
import { fake } from './test-support/fake-backend.mjs';
import { createFetchSpy } from '../../shared/recipients/fetch-spy';
import { CONSENT_CONFIG } from '../../shared/recipients/consent.ts';

const SCAN = '3f2b6c1e-8d4a-4e9b-9c11-7a5d2e0f4b10';
const SHA = 'c'.repeat(64);
const body = { scan_id: SCAN, consent_version: CONSENT_CONFIG.consent_version, consent_text_sha256: SHA, locale: 'en' };
const baseEnv = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', RESEND_API_KEY: 'resend-key', HUBSPOT_TOKEN: 'hs-token',
  EMAIL_DOMAIN_CHECK: 'false', ALLOW_PARTIAL_REPORT: 'true', WEB_SCAN_SAVE_ENABLED: 'true' };
const ORIGIN = 'https://myprivacytool.io';

// The Worker's fetch handler talks to the stubbed backend through globalThis.fetch.
async function call(F, env, method, path, payload, headers = {}) {
  const real = globalThis.fetch; globalThis.fetch = (u, i) => F.f(u, i);
  try {
    const req = new Request(`https://scan.example${path}`, { method, headers: { Origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const pending = [];
    const res = await worker.fetch(req, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);   // the confirmation email and the live checks run off the response path
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally { globalThis.fetch = real; }
}

describe('POST /api/consent', () => {
  it('records one consent per scan id and returns a consent id; a second POST returns the first and writes nothing', async () => {
    const F = fake();
    const a = await call(F, baseEnv, 'POST', '/api/consent', body);
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({ scan_id: SCAN, consent_version: '2026-11-v1', n_hours: 168, created: true });
    expect(a.json.consent_id).toMatch(/^[0-9a-f-]{36}$/);
    const b = await call(F, baseEnv, 'POST', '/api/consent', { ...body, consent_text_sha256: 'd'.repeat(64) });
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ consent_id: a.json.consent_id, created: false });
    expect(F.db.scan_consents).toHaveLength(1);
    expect(F.db.scan_consents[0].consent_text_sha256).toBe(SHA);
  });
  it('stores no IP, email or user agent: the row holds the eight consent fields and nothing else', async () => {
    const F = fake();
    await call(F, baseEnv, 'POST', '/api/consent', body, { 'CF-Connecting-IP': '203.0.113.9', 'user-agent': 'Mozilla/5.0 test' });
    const insert = F.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/scan_consents'));
    expect(Object.keys(JSON.parse(insert.body)).sort()).toEqual(['consent_text_sha256', 'consent_version', 'consented_at', 'locale', 'n_hours', 'registry_hash', 'scan_id']);
    const written = F.calls.filter((c) => c.method === 'POST').map((c) => c.body).join('\n');
    for (const secret of ['203.0.113.9', 'Mozilla']) expect(written.includes(secret)).toBe(false);
  });
  it('refuses another origin, a stale wording, extra keys and a bad scan id, and stores nothing', async () => {
    const F = fake();
    expect((await call(F, baseEnv, 'POST', '/api/consent', body, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(F, baseEnv, 'POST', '/api/consent', { ...body, consent_version: '2026-10-v1' })).status).toBe(400);
    expect((await call(F, baseEnv, 'POST', '/api/consent', { ...body, email: 'a@b.co' })).status).toBe(400);
    expect((await call(F, baseEnv, 'POST', '/api/consent', { ...body, scan_id: 'nope' })).status).toBe(400);
    expect(F.db.scan_consents).toHaveLength(0);
  });
  it('GET asks whether a journey already has a consent (so a channel never asks twice): 404 before, the consent after', async () => {
    const F = fake();
    expect((await call(F, baseEnv, 'GET', `/api/consent?scan_id=${SCAN}`)).status).toBe(404);
    const a = await call(F, baseEnv, 'POST', '/api/consent', body);
    const g = await call(F, baseEnv, 'GET', `/api/consent?scan_id=${SCAN}`);
    expect(g.status).toBe(200);
    expect(g.json.consent_id).toBe(a.json.consent_id);
    expect((await call(F, baseEnv, 'GET', '/api/consent?scan_id=nope')).status).toBe(400);
  });
});

const scanBody = (extra = {}) => ({ email: 'quiet.person@example.org', consent: true, ...extra });

describe('the server-side gate on POST /api/scan', () => {
  it('gate off (CONSENT_GATE_ENFORCED false): a scan without a consent id is accepted exactly as before', async () => {
    const F = fake();
    const r = await call(F, { ...baseEnv, CONSENT_GATE_ENFORCED: 'false' }, 'POST', '/api/scan', scanBody());
    expect(r.status).toBe(200);
    expect(F.db.scans).toHaveLength(1);
    expect(F.db.scans[0].consent_id).toBeUndefined();
  });
  it('gate on: a scan without a consent id is refused 403 consent_required before anything is stored or sent', async () => {
    const F = fake();
    const r = await call(F, { ...baseEnv, CONSENT_GATE_ENFORCED: 'true' }, 'POST', '/api/scan', scanBody());
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('consent_required');
    expect(F.db.users).toHaveLength(0);
    expect(F.calls.some((c) => c.url.includes('resend') || c.url.includes('hubapi'))).toBe(false);
  });
  it('a consent id that is not in the store is refused whatever the switch says (forged, stale or deleted)', async () => {
    for (const enforced of ['true', 'false']) {
      const F = fake();
      const r = await call(F, { ...baseEnv, CONSENT_GATE_ENFORCED: enforced }, 'POST', '/api/scan', scanBody({ consent_id: crypto.randomUUID() }));
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('consent_invalid');
      expect(F.db.users).toHaveLength(0);
    }
    expect((await call(fake(), baseEnv, 'POST', '/api/scan', scanBody({ consent_id: 'not-a-uuid' }))).json.code).toBe('consent_invalid');
  });
  it('a store that cannot be read refuses (fails closed)', async () => {
    const F = fake({ onRequest: (url, o, res) => (url.includes('scan_consents') ? res(500, 'x') : undefined) });
    const r = await call(F, baseEnv, 'POST', '/api/scan', scanBody({ consent_id: crypto.randomUUID() }));
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('consent_unverifiable');
  });
});

describe('a consented scan, end to end (gate on)', () => {
  const env = { ...baseEnv, CONSENT_GATE_ENFORCED: 'true' };
  const hex = [{ id: 'ip', label: 'IP', value: '203.0.113.9' }];

  it('the consent id lands on the scan, the consent fields are copied onto the saved web scan under the consent scan id, and every post_click call is allowed', async () => {
    const F = fake();
    const c = await call(F, env, 'POST', '/api/consent', body);
    const r = await call(F, env, 'POST', '/api/scan', scanBody({ consent_id: c.json.consent_id, scan: hex, save_consent: true, save_consent_version: '2026-11-08-v1' }));
    expect(r.status).toBe(200);
    expect(r.json.scan_saved).toBe(true);
    expect(r.json.scan_number).toBe(SCAN);                      // the client-generated scan id becomes the scan number
    expect(F.db.scans[0].consent_id).toBe(c.json.consent_id);
    const ws = F.db.web_scans[0];
    expect(ws).toMatchObject({ id: SCAN, consent_id: c.json.consent_id, consent_version: '2026-11-v1', consent_text_sha256: SHA, consent_locale: 'en', consent_n_hours: 168 });
    expect(ws.consent_registry_hash).toBe(F.db.scan_consents[0].registry_hash);
    expect(ws.consented_at).toBe(F.db.scan_consents[0].consented_at);
    expect(F.calls.some((c2) => c2.url.includes('api.resend.com'))).toBe(true);   // the confirmation email went out: check 4 passed
    expect(F.db.scan_recipient_log.length + F.calls.filter((x) => x.url.includes('scan_recipient_log')).length).toBeGreaterThan(0);
  });

  it('a second scan in the same journey gets a fresh scan number and still carries the consent fields', async () => {
    const F = fake();
    const c = await call(F, env, 'POST', '/api/consent', body);
    await call(F, env, 'POST', '/api/scan', scanBody({ consent_id: c.json.consent_id, scan: hex, save_consent: true, save_consent_version: '2026-11-08-v1' }));
    const r2 = await call(F, env, 'POST', '/api/scan', scanBody({ email: 'second.person@example.org', consent_id: c.json.consent_id, scan: hex, save_consent: true, save_consent_version: '2026-11-08-v1' }));
    expect(r2.json.scan_saved).toBe(true);
    expect(F.db.web_scans).toHaveLength(2);
    expect(F.db.web_scans[1].id).not.toBe(SCAN);
    expect(F.db.web_scans[1].consent_id).toBe(c.json.consent_id);
  });

  it('the report job (a cron tick, no request) presents the stored consent: the report is sent; for a scan WITHOUT one the post_click calls are refused and logged', async () => {
    const F = fake();
    const spy = createFetchSpy({ respond: (url, init) => F.f(url, init) });
    const c = await call(F, env, 'POST', '/api/consent', body);
    await handleScan(env, null, { email: 'quiet.person@example.org', consentSource: 'scan_page', ip: '203.0.113.9', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' }, scanConsent: F.db.scan_consents.find((x) => x.id === c.json.consent_id) }, spy.fetch);
    const out = await runReportJob(env, spy.fetch, 5);
    expect(out.sent).toBe(1);
    expect(F.db.scans[0].report_status).toBe('sent');
    spy.assertAllRegistered();

    const G = fake();
    const spy2 = createFetchSpy({ respond: (url, init) => G.f(url, init) });
    await handleScan({ ...env, CONSENT_GATE_ENFORCED: 'false' }, null, { email: 'old.queue@example.org', consentSource: 'scan_page', ip: '203.0.113.9', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' } }, spy2.fetch);
    const emailsBefore = G.calls.filter((x) => x.url.includes('api.resend.com')).length;
    const out2 = await runReportJob(env, spy2.fetch, 5);   // gate switched on while this scan has no consent
    expect(out2.sent).toBe(0);
    expect(G.calls.filter((x) => x.url.includes('api.resend.com')).length).toBe(emailsBefore);   // no report email
    expect(out2.failed).toBe(1);
    expect(G.db.scans[0].report_status).toBe('failed');
    expect(G.db.scans[0].report_last_error).toBe('consent: no consent on record for this scan');
  });
});
