// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { handleRiskRequest, MAX_BATCH } from '../mirrorRiskApi';
import { clearOsintCache } from '../osintLookup';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('Mirror & Risk API (MPC-7252)', () => {
  beforeEach(() => clearOsintCache());

  it('POST /api/v1/scan: phone is answered as not_checked with no score', async () => {
    const res = await handleRiskRequest(post('/api/v1/scan', { value: '+1 555 123 4567', type: 'phone' }), { HIBP_API_KEY: 'k' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.level).toBe('not_checked');
    expect(json.data.score).toBeNull();
  });

  it('POST /api/v1/scan: email without a key is not_checked (never "safe")', async () => {
    const res = await handleRiskRequest(post('/api/v1/scan', { value: 'a@b.co', type: 'email' }), {});
    const json = await res.json();
    expect(json.data.status).toBe('not_checked');
    expect(json.data.reason).toBe('no_api_key');
  });

  it('rejects bad type, bad JSON and arrays with 400', async () => {
    expect((await handleRiskRequest(post('/api/v1/scan', { value: 'x', type: 'ssn' }))).status).toBe(400);
    expect((await handleRiskRequest(post('/api/v1/scan', '{nope'))).status).toBe(400);
    expect((await handleRiskRequest(post('/api/v1/scan', []))).status).toBe(400);
  });

  it('invalid email gives INVALID_EMAIL and does not echo the value', async () => {
    const res = await handleRiskRequest(post('/api/v1/scan', { value: 'private text', type: 'email' }));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).toContain('INVALID_EMAIL');
    expect(text).not.toContain('private text');
  });

  it('refuses foreign browser origins and oversized bodies', async () => {
    const evil = await handleRiskRequest(post('/api/v1/scan', { value: 'a@b.co', type: 'email' }, { Origin: 'https://evil.example' }));
    expect(evil.status).toBe(403);
    const big = await handleRiskRequest(post('/api/v1/scan', { value: 'a@b.co', type: 'email' }, { 'content-length': '999999' }));
    expect(big.status).toBe(413);
  });

  it('rate limiter denial returns 429; limiter errors fail open', async () => {
    const body = { value: '+1 555 123 4567', type: 'phone' };
    const denied = await handleRiskRequest(post('/api/v1/scan', body), { RATE_LIMITER: { limit: async () => ({ success: false }) } });
    expect(denied.status).toBe(429);
    const open = await handleRiskRequest(post('/api/v1/scan', body), { RATE_LIMITER: { limit: async () => { throw new Error('down'); } } });
    expect(open.status).toBe(200);
  });

  it('batch: caps size and returns per-item results', async () => {
    const ok = await handleRiskRequest(post('/api/v1/scan/batch', { values: [{ value: 'example.com', type: 'domain' }, { value: 'handle_1', type: 'handle' }] }));
    const json = await ok.json();
    expect(json.metadata.batchSize).toBe(2);
    expect(json.results).toHaveLength(2);
    const tooMany = await handleRiskRequest(post('/api/v1/scan/batch', { values: Array(MAX_BATCH + 1).fill({ value: 'example.com', type: 'domain' }) }));
    expect(tooMany.status).toBe(400);
  });

  it('unknown routes 404; OPTIONS 204', async () => {
    expect((await handleRiskRequest(new Request('https://api.test/nope'))).status).toBe(404);
    expect((await handleRiskRequest(new Request('https://api.test/api/v1/scan', { method: 'OPTIONS' }))).status).toBe(204);
  });
});
