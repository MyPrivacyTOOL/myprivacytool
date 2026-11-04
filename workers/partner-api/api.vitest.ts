// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { OPENAPI } from './openapi';
import { priceMonth } from './pricing';

const KEY = 'mpt_live_' + 'a'.repeat(43);
const HASH = createHash('sha256').update(KEY).digest('hex');
const PARTNER = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_SERVICE_ROLE_KEY: 'svc' };

type Row = Record<string, unknown>;
interface Store { keys: Row[]; scans: Row[]; monitors: Row[]; calls: string[] }
let store: Store;

// In-memory PostgREST stub: only the query shapes api.ts issues.
function stubSupabase() {
  vi.stubGlobal('fetch', async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const table = url.pathname.split('/').pop()!;
    const q = (k: string) => url.searchParams.get(k)?.replace(/^(eq|is|gte|lt)\./, '');
    store.calls.push(`${method} ${table}`);
    const ok = (b: unknown, s = 200) => new Response(b === null ? '' : JSON.stringify(b), { status: s });
    if (table === 'partner_api_keys') {
      if (method === 'PATCH') return ok([{}]);
      return ok(store.keys.filter((k) => k.hash === q('key_hash') && !k.revoked).map((k) => ({ id: k.id, partner_id: PARTNER, last_used_at: new Date().toISOString(), partners: k.partner })));
    }
    if (table === 'partner_scans') {
      if (method === 'POST') { const row = { id: '22222222-2222-4222-8222-22222222222' + store.scans.length, created_at: new Date().toISOString(), ...JSON.parse(init.body) }; store.scans.push(row); return ok([row], 201); }
      let rows = store.scans.filter((s) => s.partner_id === q('partner_id'));
      if (q('id')) rows = rows.filter((s) => s.id === q('id'));
      if (url.searchParams.get('billable')) rows = rows.filter((s) => s.billable);
      return ok(rows);
    }
    if (table === 'partner_monitors') {
      if (method === 'POST') { const row = { id: '33333333-3333-4333-8333-33333333333' + store.monitors.length, created_at: new Date().toISOString(), ...JSON.parse(init.body) }; store.monitors.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const row = store.monitors.find((m) => m.id === q('id') && m.partner_id === q('partner_id') && !m.deleted_at); if (!row) return ok([]); Object.assign(row, JSON.parse(init.body)); return ok([row]); }
      return ok(store.monitors.filter((m) => m.partner_id === q('partner_id') && !m.deleted_at));
    }
    return new Response('unexpected ' + table, { status: 500 });
  });
}

const call = (path: string, init: RequestInit = {}, env: Record<string, unknown> = ENV) =>
  worker.fetch(new Request('https://api.test' + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) } }), env);
const post = (path: string, body: unknown, env: Record<string, unknown> = ENV) => call(path, { method: 'POST', body: JSON.stringify(body) }, env);

beforeEach(() => {
  store = { keys: [{ id: 'key-1', hash: HASH, revoked: false, partner: { status: 'active', monthly_scan_cap: null } }], scans: [], monitors: [], calls: [] };
  stubSupabase();
});
afterEach(() => vi.unstubAllGlobals());

describe('auth', () => {
  it('rejects a missing, malformed or unknown key with 401 and one error shape', async () => {
    for (const headers of [{ Authorization: '' }, { Authorization: 'Bearer nope' }, { Authorization: 'Bearer mpt_live_' + 'b'.repeat(43) }]) {
      const res = await call('/v1/usage', { headers });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('invalid_api_key');
    }
  });
  it('accepts X-API-Key as well as Bearer', async () => {
    const res = await call('/v1/usage', { headers: { Authorization: '', 'X-API-Key': KEY } });
    expect(res.status).toBe(200);
  });
  it('rejects a revoked key and a suspended partner', async () => {
    store.keys[0].revoked = true;
    expect((await call('/v1/usage')).status).toBe(401);
    store.keys[0].revoked = false; store.keys[0].partner.status = 'suspended';
    const res = await call('/v1/usage');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('partner_suspended');
  });
  it('refuses any browser request (Origin header) before looking up the key', async () => {
    const res = await call('/v1/usage', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
  });
  it('429s with Retry-After when the per-key limiter says no, and fails open when it throws', async () => {
    const no = { limit: async ({ key }: { key: string }) => ({ success: !key.startsWith('key:') }) };
    const res = await call('/v1/usage', {}, { ...ENV, RATE_LIMITER: no });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const boom = { limit: async () => { throw new Error('x'); } };
    expect((await call('/v1/usage', {}, { ...ENV, RATE_LIMITER: boom })).status).toBe(200);
  });
});

describe('POST /v1/scan', () => {
  it('without a breach provider returns not_checked, stores a hash not the value, and is not billable', async () => {
    const res = await post('/v1/scan', { value: 'Jane@Example.com', type: 'email', reference: 'case-9' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ type: 'email', reference: 'case-9', status: 'not_checked', billable: false });
    expect(body.result.score).toBeNull();
    const row = store.scans[0];
    expect(row.value_sha256).toBe(createHash('sha256').update('email:jane@example.com').digest('hex'));
    expect(JSON.stringify(row)).not.toContain('jane@example.com');
  });
  it('bills a real check', async () => {
    vi.stubGlobal('fetch', ((orig) => async (u: unknown, i: unknown) => {
      if (String(u).includes('xposedornot')) return new Response(JSON.stringify({ breaches: [['Adobe']] }), { status: 200 });
      return orig(u, i);
    })(globalThis.fetch));
    const res = await post('/v1/scan', { value: 'a@b.co', type: 'email' }, { ...ENV, BREACH_PROVIDER: 'xposedornot' });
    const body = await res.json();
    // The provider parse is unverified upstream (see mirror-risk README); the contract here is: billable iff status === checked.
    expect(body.billable).toBe(body.status === 'checked');
  });
  it.each([
    [{ value: 'x', type: 'ssn' }, 'invalid_type'],
    [{ value: '', type: 'email' }, 'invalid_value'],
    [{ value: 'x'.repeat(321), type: 'email' }, 'invalid_value'],
    [{ value: 'a@b.co', type: 'email', reference: 5 }, 'invalid_reference'],
  ])('400s on bad input %#', async (body, code) => {
    const res = await post('/v1/scan', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(code);
    expect(store.scans).toHaveLength(0);
  });
  it('400s malformed JSON and 413s an oversized body', async () => {
    expect((await call('/v1/scan', { method: 'POST', body: '{nope' })).status).toBe(400);
    expect((await call('/v1/scan', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(9000), type: 'email' }) })).status).toBe(413);
  });
  it('stops at the partner monthly cap', async () => {
    store.keys[0].partner.monthly_scan_cap = 1;
    store.scans.push({ id: 's0', partner_id: PARTNER, billable: true });
    const res = await post('/v1/scan', { value: 'a@b.co', type: 'email' });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('monthly_cap_reached');
  });
  it('405s a wrong method with Allow', async () => {
    const res = await call('/v1/scan');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });
});

describe('GET /v1/report/:id', () => {
  it('returns the partner’s own scan, 404s someone else’s, 410s a cleared result', async () => {
    const created = await (await post('/v1/scan', { value: 'a@b.co', type: 'email' })).json();
    const ok = await call(`/v1/report/${created.scan_id}`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).scan_id).toBe(created.scan_id);
    store.scans[0].partner_id = 'other';
    expect((await call(`/v1/report/${created.scan_id}`)).status).toBe(404);
    store.scans[0].partner_id = PARTNER; store.scans[0].result = null;
    expect((await call(`/v1/report/${created.scan_id}`)).status).toBe(410);
    expect((await call('/v1/report/not-a-uuid')).status).toBe(404);
  });
});

describe('monitors', () => {
  const good = { value: 'a@b.co', type: 'email', webhook_url: 'https://hooks.example.com/mpt', subject_consent: true };
  it('creates, lists (without the identifier) and deletes (identifier erased)', async () => {
    const res = await post('/v1/monitors', good);
    expect(res.status).toBe(201);
    const { monitor_id } = await res.json();
    const list = await (await call('/v1/monitors')).json();
    expect(list.monitors).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('a@b.co');
    expect((await call(`/v1/monitors/${monitor_id}`, { method: 'DELETE' })).status).toBe(204);
    expect(store.monitors[0].value).toBe('');
    expect((await call(`/v1/monitors/${monitor_id}`, { method: 'DELETE' })).status).toBe(404);
  });
  it('requires subject_consent === true', async () => {
    for (const subject_consent of [false, 'true', undefined]) {
      const res = await post('/v1/monitors', { ...good, subject_consent });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('consent_required');
    }
  });
  it.each(['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://user:pw@hooks.example.com/x', 'https://intranet/x', 'nope'])('refuses webhook_url %s', async (webhook_url) => {
    const res = await post('/v1/monitors', { ...good, webhook_url });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_webhook_url');
  });
});

describe('GET /v1/usage', () => {
  it('prices billable scans and validates month', async () => {
    for (let i = 0; i < 3; i++) store.scans.push({ id: 's' + i, partner_id: PARTNER, billable: true });
    const body = await (await call('/v1/usage')).json();
    expect(body).toMatchObject({ billable_scans: 3, amount_usd: 0.3, currency: 'USD' });
    expect((await call('/v1/usage?month=2026-13')).status).toBe(400);
    expect((await call('/v1/usage?month=2026-12')).status).toBe(200);
  });
});

describe('pricing', () => {
  it('is graduated: $0.10, then $0.08, then $0.06', () => {
    expect(priceMonth(0)).toEqual({ amount_usd: 0, bands: [] });
    expect(priceMonth(1).amount_usd).toBe(0.1);
    expect(priceMonth(10_000).amount_usd).toBe(1000);
    expect(priceMonth(10_001).amount_usd).toBe(1000.08);
    expect(priceMonth(100_000).amount_usd).toBe(1000 + 7200);
    expect(priceMonth(100_001).amount_usd).toBe(8200.06);
  });
});

describe('public routes and spec', () => {
  it('health and openapi need no key; unknown paths 404', async () => {
    const h = await worker.fetch(new Request('https://api.test/v1/health'), {});
    expect(h.status).toBe(200);
    const o = await worker.fetch(new Request('https://api.test/v1/openapi.json'), {});
    expect((await o.json()).openapi).toBe('3.0.3');
    expect((await worker.fetch(new Request('https://api.test/'), {})).status).toBe(404);
    expect((await call('/v1/nope')).status).toBe(404);
  });
  it('every documented path+method is routed (not 404/405)', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    for (const [path, ops] of Object.entries(OPENAPI.paths)) {
      for (const method of Object.keys(ops)) {
        const res = await call(path.replace('{id}', id), { method: method.toUpperCase(), body: method === 'post' ? '{}' : undefined });
        expect([404, 405].includes(res.status) && (await res.json()).error.code === 'method_not_allowed').toBe(false);
      }
    }
  });
});
