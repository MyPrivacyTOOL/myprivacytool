// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { validateLearningEvent } from './learningEvents.ts';

const ON = { LEARNING_EVENTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const web = { Origin: 'https://myprivacytool.io', 'Content-Type': 'application/json' };
const good = { event_type: 'answer', person_key: 'abcdefghijklmnop', scan_window: 'w1', hexagon_id: 'location', source: 'web-scan', tile_kind: 'our_guess', confidence_at_display: 0.95, config_version: 0, answer: 'not_me' };
let stored: any[]; let status: number;

beforeEach(() => {
  stored = []; status = 201;
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    if (String(input).includes('/rest/v1/mpt_hexagon_events')) { stored.push(JSON.parse(init.body)); return new Response('', { status }); }
    throw new Error('unexpected fetch ' + input);
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = (body: any, headers: Record<string, string> = web, env: any = ON, method = 'POST') =>
  worker.fetch(new Request('https://x/api/learning/event', { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers }), env, { waitUntil() {} });

describe('POST /api/learning/event', () => {
  it('is OFF by default: 404 as if it did not exist, and nothing is stored', async () => {
    expect((await call(good, web, { SUPABASE_SERVICE_ROLE_KEY: 'svc' })).status).toBe(404);
    expect((await call(good, web, { ...ON, LEARNING_EVENTS_ENABLED: 'yes' })).status).toBe(404);
    expect(stored).toEqual([]);
  });
  it('stores a valid answer with only the allowed fields, and says 202', async () => {
    const r = await call({ ...good, finding_value: 'London', email: 'a@b.c' });
    expect(r.status).toBe(202);
    expect(stored).toEqual([{ ...good, source: 'web-scan' }]);
    expect(JSON.stringify(stored)).not.toMatch(/London|a@b\.c/);
  });
  it('is browser-origin only: no Origin or a foreign one is refused, a preflight is answered', async () => {
    expect((await call(good, { 'Content-Type': 'application/json' })).status).toBe(403);
    expect((await call(good, { ...web, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(undefined, web, ON, 'OPTIONS')).status).toBe(204);
    expect(stored).toEqual([]);
  });
  it('refuses a big body, bad JSON and anything that is not exactly the accepted shape', async () => {
    expect((await call('x'.repeat(5000))).status).toBe(413);
    expect((await call('{nope')).status).toBe(400);
    for (const bad of [
      { ...good, person_key: 'short' }, { ...good, hexagon_id: 'not-a-hexagon' }, { ...good, answer: 'maybe' }, { ...good, answer: null },
      { ...good, event_type: 'shown' /* shown cannot carry an answer */ }, { ...good, confidence_at_display: 1.5 }, { ...good, tile_kind: 'free text' },
      { ...good, source: 'other' }, { ...good, config_version: -1 }, { ...good, scan_window: 'has spaces' },
    ]) expect((await call(bad)).status).toBe(400);
    expect(stored).toEqual([]);
  });
  it('counts the body in bytes, not characters, and refuses a declared oversize before reading it', async () => {
    expect((await call({ ...good, pad: 'é'.repeat(1500) })).status).toBe(413);   // about 1530 characters, over 3000 bytes
    expect((await call(good, { ...web, 'Content-Length': '999999' })).status).toBe(413);
    expect(stored).toEqual([]);
  });
  it('logs a failed write without the database error text, which can quote the row', async () => {
    status = 409;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await call({ ...good, event_type: 'shown', answer: undefined })).status).toBe(202);
    expect(err.mock.calls.flat().join(' ')).toMatch(/insert failed: 409$/);
  });
  it('is rate limited per address: 429 with Retry-After and nothing stored; no binding, or one that errors, fails open', async () => {
    const seen: string[] = [];
    const limiter = (success: boolean) => ({ limit: async ({ key }: { key: string }) => { seen.push(key); return { success }; } });
    const r = await call(good, { ...web, 'CF-Connecting-IP': '203.0.113.9' }, { ...ON, RATE_LIMITER: limiter(false) });
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('60');
    expect(stored).toEqual([]);
    expect(seen).toEqual(['learning:203.0.113.9']);
    expect((await call(good, web, { ...ON, RATE_LIMITER: limiter(true) })).status).toBe(202);
    expect((await call(good, web, { ...ON, RATE_LIMITER: { limit: async () => { throw new Error('down'); } } })).status).toBe(202);
    expect((await call(good, web, ON)).status).toBe(202);
  });
  it('a shown event needs no answer; a storage failure is logged but the visitor still gets 202', async () => {
    status = 500;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { answer: _a, ...shown } = { ...good, event_type: 'shown' };
    expect((await call(shown)).status).toBe(202);
    expect(warn).toHaveBeenCalled();
  });
  it('validateLearningEvent accepts the exact shape and rejects non-objects', () => {
    expect(validateLearningEvent(good)).toMatchObject({ event_type: 'answer', answer: 'not_me' });
    expect(validateLearningEvent(null)).toBeNull();
    expect(validateLearningEvent('x')).toBeNull();
  });
});
