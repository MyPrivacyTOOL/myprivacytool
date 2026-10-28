// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { proofSid, CONSENT_VERSION } from './pop.ts';
import { getConversationState, saveConversationState, purgeExpiredState, STATE_TTL_MS } from './state-store.js';

const ENV = { SUPABASE_SERVICE_ROLE_KEY: 'svc' };
let reqs: { url: string; method: string; body: any; headers: any }[]; let status: number; let contentRange: string; let seed: Record<string, any>;
let ledgerProof: any;   // MPC-8737: the PoP proof is a ledger row, read through the mpt_ledger_pop_check RPC

beforeEach(() => {
  reqs = []; status = 200; contentRange = '*/0'; seed = {}; ledgerProof = null;
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    reqs.push({ url: String(input), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    if (String(input).includes('firestore.googleapis.com')) return new Response('', { status: 404 });
    if (String(input).includes('/rest/v1/rpc/mpt_ledger_pop_check')) return new Response(JSON.stringify({ proof: ledgerProof && ledgerProof.sid === JSON.parse(init.body).p_sid ? ledgerProof.proof : null, revoked_at_ms: null }));
    const key = decodeURIComponent(/key=eq\.([^&]+)/.exec(String(input))?.[1] ?? '');
    const body = init.method === 'DELETE' ? '' : seed[key] ? JSON.stringify([{ state: seed[key] }]) : '[]';
    return new Response(body, { status, headers: { 'Content-Range': contentRange } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('state store', () => {
  it.each(['deepdive:abc', 'deepdive_latest:85212345678', 'whatsapp:85212345678', 'telegram:1', 'messenger:2', 'sms:+44', 'email:a@b.c', 'lead:a@b.c'])('%s goes to Supabase, never Firestore', async (key) => {
    await saveConversationState(ENV, key, { a: 1 }); await getConversationState(ENV, key);
    expect(reqs).toHaveLength(2);
    expect(reqs.every((r) => r.url.includes('/rest/v1/mpt_conversation_state'))).toBe(true);
    expect(reqs.some((r) => r.url.includes('firestore.googleapis.com'))).toBe(false);
  });
  it('a stored state is read back unchanged', async () => {
    seed['telegram:1'] = { stage: 'awaiting_confirmation', platform: 'telegram' };
    expect(await getConversationState(ENV, 'telegram:1')).toEqual({ stage: 'awaiting_confirmation', platform: 'telegram' });
  });
  it('the Telegram confirmation flow works on Supabase alone (no Firestore variables)', async () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'svc', TELEGRAM_BOT_KEY: 'bot', TELEGRAM_WEBHOOK_SECRET: 'tws' };
    const hit = () => worker.fetch(new Request('https://x/webhook/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tws' },
      body: JSON.stringify({ message: { from: { id: 7 }, chat: { id: 7 }, text: 'hi' } }) }), env, { waitUntil() {} });
    const r = await hit();
    expect(r.status).toBe(200);
    const saved = reqs.find((q) => q.method === 'POST' && q.url.includes('mpt_conversation_state'));
    expect(saved?.body.key).toBe('telegram:7');
    expect(saved?.body.state.stage).toBe('awaiting_confirmation');
    expect(reqs.some((q) => q.url.includes('firestore.googleapis.com'))).toBe(false);
  });
});

describe('24 h life', () => {
  it('a scan keeps its own expires_at; any other row expires 24 h after the write', async () => {
    const scanExp = Date.now() + 5000;
    await saveConversationState(ENV, 'deepdive:x', { expires_at: scanExp });
    await saveConversationState(ENV, 'deepdive_latest:1', { scan_id: 'x' });
    const [scan, ptr] = reqs.map((r) => r.body);
    expect(scan.expires_at).toBe(new Date(scanExp).toISOString());
    const life = Date.parse(ptr.expires_at) - Date.parse(ptr.updated_at);
    expect(life).toBe(STATE_TTL_MS);
  });
  it('a read asks only for unexpired rows', async () => {
    await getConversationState(ENV, 'deepdive:x');
    expect(reqs[0].url).toMatch(/expires_at=gt\.\d{4}-/);
  });
  it('a missing key or a database error is soft: null / no throw', async () => {
    expect(await getConversationState({}, 'deepdive:x')).toBeNull();
    await saveConversationState({}, 'deepdive:x', {});
    expect(reqs).toHaveLength(0);
    status = 500;
    expect(await getConversationState(ENV, 'deepdive:x')).toBeNull();
    await expect(saveConversationState(ENV, 'deepdive:x', {})).resolves.toBeUndefined();
  });
});

describe('purge', () => {
  it('deletes only rows past expires_at and reports the count', async () => {
    contentRange = '*/3';
    expect(await purgeExpiredState(ENV)).toBe(3);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe('DELETE');
    expect(reqs[0].url).toMatch(/mpt_conversation_state\?expires_at=lt\.\d{4}-/);   // the only filter: nothing unexpired can match
  });
  it('is skipped without the key and fails soft', async () => {
    expect(await purgeExpiredState({})).toBe(-1);
    expect(reqs).toHaveLength(0);
    status = 500;
    expect(await purgeExpiredState(ENV)).toBe(-1);
  });
  it('a successful start-deep-dive purges expired rows off the response path; a refused one does not', async () => {
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) };
    const env = { ...ENV, DEEP_DIVE_SECRET: 's', PHONE_SCAN_WEB_ENABLED: '1', POP_HMAC_SECRET: 'p'.repeat(40) };
    const session_token = 'T'.repeat(43);
    const start = (headers: Record<string, string>) => worker.fetch(new Request('https://x/api/scan/start-deep-dive', { method: 'POST', body: '{}', headers }), env, ctx);
    expect((await start({})).status).toBe(401);
    await Promise.all(waits);
    expect(reqs.some((r) => r.method === 'DELETE')).toBe(false);
    seed['whatsapp:85212345678'] = { profileName: 'Alex' };
    ledgerProof = { sid: await proofSid(env, session_token), proof: { wa: '85212345678', bound_at_ms: Date.now(), inbound_ts: 1760000000, consent_v: CONSENT_VERSION, consent_accepted: true } };
    const ok = await worker.fetch(new Request('https://x/api/scan/start-deep-dive', { method: 'POST', body: JSON.stringify({ wa_id: '85212345678', session_token }), headers: { 'X-Webhook-Secret': 's' } }), env, ctx);
    expect(ok.status).toBe(200);
    await Promise.all(waits);
    expect(reqs.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });
  it('the scheduled handler still runs it (for when the account has a free cron slot)', async () => {
    const waits: Promise<unknown>[] = [];
    await (worker as any).scheduled({}, ENV, { waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(reqs.map((r) => r.method)).toEqual(['DELETE']);
  });
});
