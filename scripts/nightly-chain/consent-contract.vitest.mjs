// @vitest-environment node
// MPC-10608: the nightly chain's requests against the REAL scan-report Worker code (stubbed backend). The nightly failed because its setup recorded no scan consent,
// which only the production report job refuses; the runner's own tests use a fake Worker, so this is what ties its requests to the real consent store and gate.
import { describe, it, expect } from 'vitest';
import worker, { runReportJob } from '../../workers/scan-report/index.js';
import { fake } from '../../workers/scan-report/test-support/fake-backend.mjs';
import { fixtureScan, scanRequestBody, consentRequestBody } from './checks.mjs';

const SCAN = '3f2b6c1e-8d4a-4e9b-9c11-7a5d2e0f4b10';
const EMAIL = 'testingnt69+nightly-20261128@gmail.com';
const ORIGIN = 'https://www.myprivacytool.io';
const NO_CONSENT = 'consent: no consent on record for this scan';
const baseEnv = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', RESEND_API_KEY: 'resend-key', EMAIL_DOMAIN_CHECK: 'false', ALLOW_PARTIAL_REPORT: 'true', WEB_SCAN_SAVE_ENABLED: 'true' };
const gated = { ...baseEnv, CONSENT_GATE_ENFORCED: 'true' };

async function call(F, env, path, payload) {
  const real = globalThis.fetch; globalThis.fetch = (u, i) => F.f(u, i);
  try {
    const req = new Request(`https://scan.example${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const pending = [];
    const res = await worker.fetch(req, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally { globalThis.fetch = real; }
}

describe('nightly chain consent setup (MPC-10608)', () => {
  it('the Worker records the consent and attaches it to the request, and the gated report job does not refuse it', async () => {
    const F = fake();
    const consent = await call(F, baseEnv, '/api/consent', consentRequestBody(SCAN));
    expect(consent.status).toBe(201);
    // baseEnv = the synthetic Worker (gate off), as in the real run; the report job below runs with the production gate on.
    const scan = await call(F, baseEnv, '/api/scan', { ...scanRequestBody(EMAIL, fixtureScan()), consent_id: consent.json.consent_id });
    expect(scan.status).toBe(200);
    expect(F.db.scans).toHaveLength(1);
    expect(F.db.scans[0].consent_id).toBe(consent.json.consent_id);
    await runReportJob(gated, F.f);
    expect(F.db.scans[0].report_last_error ?? null).not.toBe(NO_CONSENT);
    expect(F.db.scans[0].report_status).toBe('sent');
  });

  it('without that step the synthetic Worker still accepts the scan and the gated report job refuses it (the gate stands)', async () => {
    const F = fake();
    const scan = await call(F, baseEnv, '/api/scan', scanRequestBody(EMAIL, fixtureScan()));
    expect(scan.status).toBe(200);
    await runReportJob(gated, F.f);
    expect(F.db.scans[0]).toMatchObject({ report_status: 'failed', report_last_error: NO_CONSENT });
  });
});
