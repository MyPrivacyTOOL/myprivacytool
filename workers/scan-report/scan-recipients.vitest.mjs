// @vitest-environment node
// MPC-9893: GET /api/scan/recipients?scan_number=... returns the scan_recipient_log rows for one saved scan: names only, oldest first, read-only.
import { describe, it, expect } from 'vitest';
import worker from './index.js';
import { fake } from './test-support/fake-backend.mjs';

const NUMBER = '3f2b6c1e-8d4a-4e9b-9c11-7a5d2e0f4b10';
const SCAN_ID = '9a1d2c3e-5b6f-4a70-8c91-0d2e3f4a5b6c';
const OTHER = '11111111-2222-4333-8444-555555555555';
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key' };
const ORIGIN = 'https://myprivacytool.io';

async function get(F, path, headers = { Origin: ORIGIN }) {
  const real = globalThis.fetch; globalThis.fetch = (u, i) => F.f(u, i);
  try {
    const res = await worker.fetch(new Request(`https://scan.example${path}`, { method: 'GET', headers }), env, { waitUntil: () => {} });
    return { status: res.status, json: await res.json().catch(() => null), calls: F.calls };
  } finally { globalThis.fetch = real; }
}
const seed = (F) => {
  F.db.web_scan_contacts.push({ id: 'c1', web_scan_id: NUMBER, channel: 'email', contact_id: SCAN_ID });
  F.db.scan_recipient_log.push(
    { scan_id: SCAN_ID, recipient_key: 'resend', items: ['email'], status: 'ran', http_status: 200, code: null, at: '2026-11-09T10:00:09Z' },
    { scan_id: SCAN_ID, recipient_key: 'hibp', items: [], status: 'skipped_disabled', http_status: null, code: 'DISABLED', at: '2026-11-09T10:00:03Z' },
    { scan_id: OTHER, recipient_key: 'supabase', items: ['email'], status: 'ran', http_status: 201, code: null, at: '2026-11-09T10:00:05Z' },
  );
};

describe('GET /api/scan/recipients', () => {
  it("returns this scan's rows oldest first in the browser's record shape, and nobody else's", async () => {
    const F = fake(); seed(F);
    const r = await get(F, `/api/scan/recipients?scan_number=${NUMBER}`);
    expect(r.status).toBe(200);
    expect(r.json.scan_number).toBe(NUMBER);
    expect(r.json.records).toEqual([
      { key: 'hibp', items: [], at: '2026-11-09T10:00:03Z', status: 'skipped_disabled', code: 'DISABLED' },
      { key: 'resend', items: ['email'], at: '2026-11-09T10:00:09Z', status: 'ran', http_status: 200 },
    ]);
  });
  it('returns names only: no URL, header, value or email ever appears in the answer', async () => {
    const F = fake(); seed(F);
    const r = await get(F, `/api/scan/recipients?scan_number=${NUMBER}`);
    expect(JSON.stringify(r.json)).not.toMatch(/@|https?:|authorization|apikey/i);
  });
  it('answers an empty list for a number that has no rows, the same as one that does not exist', async () => {
    const F = fake();
    const r = await get(F, `/api/scan/recipients?scan_number=${NUMBER}`);
    expect(r.status).toBe(200);
    expect(r.json.records).toEqual([]);
  });
  it('rejects a missing or malformed scan number and a foreign origin, and touches nothing outside our own database', async () => {
    const F = fake(); seed(F);
    expect((await get(F, '/api/scan/recipients')).status).toBe(400);
    expect((await get(F, '/api/scan/recipients?scan_number=not-a-uuid')).status).toBe(400);
    expect((await get(F, `/api/scan/recipients?scan_number=${NUMBER}`, { Origin: 'https://evil.example' })).status).toBe(403);
    const ok = await get(F, `/api/scan/recipients?scan_number=${NUMBER}`);
    for (const c of ok.calls) expect(c.url).toContain('/rest/v1/');
  });
  it('only reads: it never writes, so it cannot be used to create or change a record', async () => {
    const F = fake(); seed(F);
    await get(F, `/api/scan/recipients?scan_number=${NUMBER}`);
    expect(F.calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
