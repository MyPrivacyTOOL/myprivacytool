// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MPC-7902 security tests. Synthetic numbers, a mocked provider layer, and an in-memory stand-in for the PostgREST store that implements
 * the semantics the code relies on (expiry filter, ignore-duplicates insert, DELETE ... RETURNING).
 * MPC-8737: the proof and its revocation now live in the data-point ledger, so the stand-in also implements the three ledger RPCs the Worker
 * calls (mpt_ledger_pop_bind / _check / _revoke) with the same contract as the SQL (one proof per session, expiry, newest revocation). Nothing here can reach a real provider,
 * Meta or Supabase: `fetch` is replaced and any unrecognised URL throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { checkPossession, proofSid, CONSENT_VERSION, MAX_WRONG_CODES, CHALLENGE_TTL_MS, VERIFY_PROMPT } from './pop.ts';

const SECRET = 'dd-secret';
const WA = '85212345678';
const OTHER = '85298765432';
const HMAC = 'h'.repeat(48);
const BASE_ENV: Record<string, any> = {
  PHONE_SCAN_WEB_ENABLED: '1', POP_HMAC_SECRET: HMAC, DEEP_DIVE_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'svc', META_APP_SECRET: 'app-secret',
  WHATSAPP_PHONE_NUMBER_ID: '999', META_WHATSAPP_KEY: 'tok', WHATSAPP_BOT_NUMBER: '15550001111',
  RAPIDAPI_KEY: 'rk', RAPIDAPI_WHATSAPP_HOST: 'wa.example', SPAM_API_URL: 'https://spam.example/v1', SPAM_API_KEY: 'sk',
};
const web = { Origin: 'https://myprivacytool.io' };
const srv = { 'X-Webhook-Secret': SECRET };

let rows: Map<string, { state: any; exp: number }>;
let events: string[];                        // ordered: store writes, provider calls, Meta replies
let providerCalls: number;
let replies: { to: string; body: string }[];
let fail: (method: string, key: string) => boolean;
let collide: number;                         // next N ignore-duplicates inserts report "key already held"
let logs: string[];
let msgSeq = 0;
/** MPC-8737: the ledger stand-in. `proofs` is keyed by the session's HMAC (ledger subject_ref); wa is stored as digits, as the RPC returns it. */
let ledger: { proofs: Map<string, { wa: string; bound_at_ms: number; inbound_ts: number; consent_v: string; consent_accepted: boolean; exp: number }>; revs: Map<string, { at: number; exp: number }> };
let failLedger: (fn: string) => boolean;
let rpcCalls: { fn: string; args: any }[];
let checkShape: (b: any) => any;             // lets a test corrupt the check response

const tick = () => new Promise((r) => setImmediate(r));
const keyOf = (url: string) => decodeURIComponent(/key=eq\.([^&]+)/.exec(url)?.[1] ?? '');

beforeEach(() => {
  rows = new Map(); events = []; providerCalls = 0; replies = []; fail = () => false; collide = 0; logs = []; msgSeq = 0;
  ledger = { proofs: new Map(), revs: new Map() }; failLedger = () => false; rpcCalls = []; checkShape = (b) => b;
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: any[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); });
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input); const method = init.method || 'GET';
    const rpcName = /\/rest\/v1\/rpc\/(mpt_ledger_pop_\w+)/.exec(url)?.[1];
    if (rpcName) {
      await tick();
      const args = JSON.parse(init.body); rpcCalls.push({ fn: rpcName, args });
      if (failLedger(rpcName)) return new Response('boom', { status: 500 });
      const live = <T extends { exp: number }>(r: T | undefined) => (r && r.exp > Date.now() ? r : undefined);
      if (rpcName === 'mpt_ledger_pop_bind') {
        if (ledger.proofs.has(args.p_sid)) return new Response('{"code":"23505"}', { status: 409 });   // one proof per session, never overwritten
        events.push('put:pop_sess');
        ledger.proofs.set(args.p_sid, { wa: args.p_wa, bound_at_ms: args.p_bound_at_ms, inbound_ts: args.p_inbound_ts, consent_v: args.p_consent_v, consent_accepted: args.p_consent_accepted, exp: args.p_bound_at_ms + args.p_ttl_seconds * 1000 });
        return new Response('true');
      }
      if (rpcName === 'mpt_ledger_pop_revoke') {
        events.push('put:pop_rev');
        if ([...ledger.proofs.values()].some((p) => p.wa === args.p_wa)) ledger.revs.set(args.p_wa, { at: args.p_at_ms, exp: args.p_at_ms + args.p_ttl_seconds * 1000 });
        return new Response('true');
      }
      const pr = live(ledger.proofs.get(args.p_sid));
      const rv = pr ? live(ledger.revs.get(pr.wa)) : undefined;
      return new Response(JSON.stringify(checkShape({ proof: pr ? { wa: pr.wa, bound_at_ms: pr.bound_at_ms, inbound_ts: pr.inbound_ts, consent_v: pr.consent_v, consent_accepted: pr.consent_accepted } : null, revoked_at_ms: rv ? rv.at : null })));
    }
    if (url.includes('/rest/v1/mpt_conversation_state')) {
      await tick();                                                      // let concurrent callers interleave, so read-then-delete would be caught
      const key = keyOf(url);
      if (fail(method, key)) return new Response('boom', { status: 500 });
      const live = (k: string) => { const r = rows.get(k); return r && r.exp > Date.now() ? r : undefined; };
      if (method === 'POST') {
        const row = JSON.parse(init.body); const prefer = String(init.headers?.Prefer);
        events.push(`put:${row.key.split(':')[0]}`);
        if (prefer.includes('ignore-duplicates')) {
          if (collide > 0 && row.key.startsWith('pop_ch:')) { collide--; return new Response('[]'); }
          if (live(row.key)) return new Response('[]');
        }
        rows.set(row.key, { state: row.state, exp: Date.parse(row.expires_at) });
        return new Response(prefer.includes('return=representation') ? JSON.stringify([{ key: row.key }]) : '', { status: 201 });
      }
      if (method === 'DELETE') {
        if (!key) return new Response('', { headers: { 'Content-Range': '*/0' } });
        const r = live(key); rows.delete(key); events.push(`take:${key.split(':')[0]}`);
        return new Response(JSON.stringify(r ? [{ state: r.state }] : []));
      }
      const r = live(key);
      return new Response(JSON.stringify(r ? [{ state: r.state }] : []));
    }
    if (url.startsWith('https://wa.example') || url.startsWith('https://spam.example')) { providerCalls++; events.push('provider'); return new Response(JSON.stringify(url.includes('spam') ? { flags: 0 } : { profile_pic_url: null, is_business: false })); }
    if (url.includes('graph.facebook.com')) { const b = JSON.parse(init.body); replies.push({ to: b.to, body: b.text.body }); events.push('reply'); return new Response(JSON.stringify({ messages: [{ id: 'x' }] })); }
    if (url.includes('/rest/v1/')) return new Response('', { status: 201 });
    throw new Error('unexpected fetch (tests must never reach a real service): ' + url);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const call = (path: string, body?: any, headers: Record<string, string> = {}, env = BASE_ENV, method = 'POST') =>
  worker.fetch(new Request('https://x' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers }), env, { waitUntil() {} });

async function sign(raw: string, secret = 'app-secret') {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** An inbound WhatsApp webhook as Meta would sign it. */
async function inbound(text: string, from = WA, o: { id?: string; env?: any; secret?: string; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Synthetic' } }], messages: [{ id: o.id ?? `wamid.${++msgSeq}`, from, timestamp: '1760000001', type: 'text', text: { body: text } }] } }] }] });
  return worker.fetch(new Request('https://x/webhook/whatsapp', { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': await sign(raw, o.secret) } }), o.env ?? BASE_ENV, { waitUntil() {} });
}
const challenge = async (body: any = { target: WA, consent: true }, env = BASE_ENV) => { const r = await call('/api/pop/challenge', body, web, env); return { r, j: await r.json() as any }; };
const scan = (session_token: any, wa_id = WA, env = BASE_ENV) => call('/api/scan/start-deep-dive', { wa_id, session_token }, srv, env);
async function bound(wa = WA) { const { j } = await challenge({ target: wa, consent: true }); await inbound(j.code, wa); return j as { session_token: string; code: string }; }
const persisted = (prefix: string) => (prefix === 'pop_sess:' ? [...ledger.proofs.keys()] : [...rows.keys()].filter((k) => k.startsWith(prefix)));   // proofs are ledger rows now

describe('MPC-7902 gate: unverified is refused and no provider is called', () => {
  it('no session, unknown session, malformed session, and the old timestamp-only path all return 403 with the verification prompt', async () => {
    rows.set(`whatsapp:${WA}`, { state: { profileName: 'X', inbound_message_timestamp: 1760000000 }, exp: Date.now() + 1e6 });   // the legacy "proof": must no longer open anything
    for (const tok of [undefined, 'short', 'A'.repeat(43), 'not a token!'.padEnd(43, 'x')]) {
      const r = await scan(tok); const j = await r.json() as any;
      expect(r.status).toBe(403); expect(j.error).toBe('verification_required'); expect(j.prompt).toBe(VERIFY_PROMPT);
    }
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA }, srv)).status).toBe(403);
    expect(providerCalls).toBe(0);
  });

  it('a web session that only asked for a code (never sent it) is not verified; opening the deep link proves nothing', async () => {
    const { j } = await challenge();
    expect(j.whatsapp_link).toBe(`https://wa.me/15550001111?text=${encodeURIComponent(j.code)}`);
    expect((await scan(j.session_token)).status).toBe(403);
    const st = await call('/api/pop/status', { session_token: j.session_token }, web);
    expect(st.status).toBe(403); expect((await st.json() as any).verified).toBe(false);
    expect(providerCalls).toBe(0);
  });

  it('no bot number configured: no link and no number is published', async () => {
    const { j } = await challenge(undefined, { ...BASE_ENV, WHATSAPP_BOT_NUMBER: undefined });
    expect(j.whatsapp_link).toBeNull();
    expect(JSON.stringify(j)).not.toContain('wa.me');
    expect(Object.keys(j).sort()).toEqual(["code", "expires_at", "prompt", "session_token", "whatsapp_link"]);   // no bot number field
  });
});

describe('MPC-7902 gate: valid handshake', () => {
  it('records the proof durably BEFORE any provider call, then a verified, consented target proceeds to the (mocked) check', async () => {
    const { session_token, code } = await bound();
    expect(persisted('pop_sess:')).toHaveLength(1);
    const stored = ledger.proofs.get(await proofSid(BASE_ENV, session_token))!;
    expect(stored).toMatchObject({ wa: WA, consent_v: CONSENT_VERSION, consent_accepted: true });
    expect(rows.has(`pop_ch:${[...rows.keys()].find((k) => k.startsWith('pop_ch:'))}`)).toBe(false);   // challenge consumed
    expect(JSON.stringify([...rows.keys()])).not.toContain(code); expect(JSON.stringify([...rows.keys()])).not.toContain(session_token);   // only hashes at rest
    expect(replies.at(-1)).toMatchObject({ to: WA }); expect(replies.at(-1)!.body).toMatch(/^Verified\./);

    const st = await call('/api/pop/status', { session_token }, web);
    expect(await st.json()).toEqual({ verified: true });                                       // never returns the wa_id
    events.length = 0;
    const r = await scan(session_token);
    expect(r.status).toBe(200);
    const j = await r.json() as any; expect(j.hexagons.length).toBeGreaterThan(0); expect(JSON.stringify(j)).not.toContain(WA);
    const firstProvider = events.indexOf('provider');
    expect(firstProvider).toBeGreaterThanOrEqual(0);
    expect(events.slice(0, firstProvider)).not.toContain('put:pop_sess');                      // the proof write is already behind us (it happened before this scan call)
    expect(providerCalls).toBeGreaterThan(0);
  });

  it('write order across the whole handshake: challenge -> take -> proof write -> confirmation reply -> provider', async () => {
    const { j } = await challenge(); await inbound(j.code); await scan(j.session_token);
    const order = events.filter((e) => ['put:pop_ch', 'take:pop_ch', 'put:pop_sess', 'reply', 'provider'].includes(e));
    expect(order.slice(0, 4)).toEqual(['put:pop_ch', 'take:pop_ch', 'put:pop_sess', 'reply']);
    expect(order.at(-1)).toBe('provider');
  });

  it('the code is accepted in lower case and inside a sentence', async () => {
    const { j } = await challenge(); await inbound(`hi, my code is ${j.code.toLowerCase()} thanks`);
    expect((await scan(j.session_token)).status).toBe(200);
  });
});

describe('MPC-7902: forged, invalid, expired, consumed', () => {
  it('forged webhook: wrong signature, missing signature, wrong secret => 401 and nothing is bound', async () => {
    const { j } = await challenge();
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'f1', from: WA, timestamp: '1', type: 'text', text: { body: j.code } }] } }] }] });
    expect((await inbound('', WA, { raw, secret: 'wrong-secret' })).status).toBe(401);
    expect((await worker.fetch(new Request('https://x/webhook/whatsapp', { method: 'POST', body: raw }), BASE_ENV, { waitUntil() {} })).status).toBe(401);
    expect((await inbound('', WA, { raw, env: { ...BASE_ENV, META_APP_SECRET: undefined } })).status).toBe(401);   // fails closed with no secret configured
    expect(persisted('pop_sess:')).toHaveLength(0); expect(persisted('pop_ch:')).toHaveLength(1);                  // challenge untouched
    expect((await scan(j.session_token)).status).toBe(403);
  });

  it('a delivery receipt (statuses) or an event with no inbound message never binds', async () => {
    const { j } = await challenge();
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.out', status: 'delivered', recipient_id: WA, text: { body: j.code } }] } }] }] });
    expect((await inbound('', WA, { raw })).status).toBe(200);
    expect(persisted('pop_sess:')).toHaveLength(0);
  });

  it('wrong code, malformed code, expired code, consumed code', async () => {
    const { j } = await challenge();
    await inbound('MPT-AAAA-BBBB'); await inbound('MPT-ZZZZ-2222'); await inbound('no code at all');
    expect(persisted('pop_sess:')).toHaveLength(0);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + CHALLENGE_TTL_MS + 1000);
    await inbound(j.code, WA, { id: 'late' });
    expect(persisted('pop_sess:')).toHaveLength(0);                                    // expired
    vi.useRealTimers();
    const k = await bound();                                                           // fresh, then reuse the consumed code
    const sessions = persisted('pop_sess:').length;
    await inbound(k.code, OTHER);
    expect(persisted('pop_sess:')).toHaveLength(sessions);
    expect(replies.at(-1)!.body).toMatch(/did not work/);
  });

  it('duplicate inbound event (Meta redelivery of the same message id): one binding, one reply, no strike', async () => {
    const { j } = await challenge();
    await inbound(j.code, WA, { id: 'wamid.same' }); const n = replies.length;
    await inbound(j.code, WA, { id: 'wamid.same' });
    expect(replies).toHaveLength(n);
    expect(persisted('pop_sess:')).toHaveLength(1); expect(persisted('pop_try:')).toHaveLength(0);
  });

  it('replay with a NEW message id carrying a consumed code is refused', async () => {
    const { j } = await challenge(); await inbound(j.code);
    const sess = { ...ledger.proofs.get(await proofSid(BASE_ENV, j.session_token))! };
    await inbound(j.code, OTHER);
    expect(ledger.proofs.get(await proofSid(BASE_ENV, j.session_token))).toEqual(sess);   // unchanged: not rebound to OTHER
  });

  it('concurrent redemption of one code by two senders: exactly one wins', async () => {
    const { j } = await challenge({ consent: true });                                   // no declared target, so both senders pass the target check
    await Promise.all([inbound(j.code, WA), inbound(j.code, OTHER)]);
    expect(persisted('pop_sess:')).toHaveLength(1);
    expect(replies.filter((r) => r.body.startsWith('Verified.'))).toHaveLength(1);
    const winner = ledger.proofs.get(await proofSid(BASE_ENV, j.session_token))!.wa;
    expect([WA, OTHER]).toContain(winner);
  });

  it('brute force: after the wrong-code limit a sender is locked out, even with a valid code; other senders are unaffected', async () => {
    const { j } = await challenge({ consent: true });
    for (let i = 0; i < MAX_WRONG_CODES; i++) await inbound(`MPT-AAAA-${'B'.repeat(3)}${i + 2}`);
    await inbound(j.code, WA);                                                          // the guesser, now with the valid code
    expect(persisted('pop_sess:')).toHaveLength(0);
    expect(replies.at(-1)!.body).toMatch(/Too many attempts/);
    await inbound(j.code, OTHER);                                                       // a different sender, valid code
    expect(persisted('pop_sess:')).toHaveLength(1);
  });

  it('challenge creation: consent is explicit, bad targets and oversize bodies are refused, collisions are redrawn, a failing limiter means no challenge', async () => {
    expect((await challenge({ target: WA })).r.status).toBe(400);
    expect((await challenge({ target: WA, consent: 'yes' })).r.status).toBe(400);
    expect((await challenge({ target: 'abc', consent: true })).r.status).toBe(400);
    expect((await call('/api/pop/challenge', { target: WA, consent: true, pad: 'x'.repeat(5000) }, web)).status).toBe(400);
    collide = 2; const ok = await challenge(); expect(ok.r.status).toBe(200);
    collide = 99; expect((await challenge()).r.status).toBe(503);
    expect((await challenge(undefined, { ...BASE_ENV, RATE_LIMITER: { limit: async () => ({ success: false }) } })).r.status).toBe(429);
    expect((await challenge(undefined, { ...BASE_ENV, RATE_LIMITER: { limit: async () => { throw new Error('x'); } } })).r.status).toBe(503);
    expect((await call('/api/pop/challenge', { consent: true }, { Origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('MPC-7902: sender / target / session binding', () => {
  it('sender is not the declared target: refused, code is spent, nothing bound, the expected number is not revealed', async () => {
    const { j } = await challenge({ target: WA, consent: true });
    await inbound(j.code, OTHER);
    expect(persisted('pop_sess:')).toHaveLength(0);
    expect(replies.at(-1)!.body).not.toContain(WA);
    await inbound(j.code, WA);                                                          // the real owner cannot use a code that was already burned
    expect(persisted('pop_sess:')).toHaveLength(0);
  });

  it('the client cannot choose its session token, code or wa_id (fixation): supplied values are ignored', async () => {
    const mine = 'A'.repeat(43);
    const { j } = await challenge({ target: WA, consent: true, session_token: mine, code: 'MPT-AAAA-AAAA', wa_id: OTHER });
    expect(j.session_token).not.toBe(mine); expect(j.code).not.toBe('MPT-AAAA-AAAA');
    await inbound(j.code, WA);
    expect((await scan(mine)).status).toBe(403);                                        // the attacker-chosen token holds nothing
    expect((await scan(j.session_token)).status).toBe(200);
  });

  it('cross-session confusion: verifying session A does not verify session B for the same number, and B cannot reuse A\'s proof', async () => {
    const a = await bound();
    const b = await challenge();                                                        // B asked for a code but never sent it
    expect((await scan(b.j.session_token)).status).toBe(403);
    expect((await scan(a.session_token)).status).toBe(200);
  });

  it('challenge swapping: a code belongs to the session that asked for it; binding goes to THAT session only', async () => {
    const a = await challenge({ consent: true }); const b = await challenge({ consent: true });
    await inbound(b.j.code, WA);                                                        // WA sends B's code
    expect((await scan(a.j.session_token)).status).toBe(403);
    expect((await scan(b.j.session_token)).status).toBe(200);
  });

  it('target changes after verification are refused and no provider is called', async () => {
    const { session_token } = await bound();
    const r = await scan(session_token, OTHER); const j = await r.json() as any;
    expect(r.status).toBe(403); expect(j.error).toBe('target_mismatch');
    expect(providerCalls).toBe(0);
    expect((await checkPossession(BASE_ENV, { token: session_token, target: 'garbage' }))).toMatchObject({ ok: false, error: 'target_invalid' });
  });

  it('a proof expires', async () => {
    const { session_token } = await bound();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect((await scan(session_token)).status).toBe(403);
    expect(providerCalls).toBe(0);
  });
});

describe('MPC-7902: consent, revocation, bypass', () => {
  it('missing or withdrawn consent on the stored proof is refused', async () => {
    const { session_token } = await bound();
    const row = ledger.proofs.get(await proofSid(BASE_ENV, session_token))!;
    row.consent_accepted = false;
    expect(await (await scan(session_token)).json()).toMatchObject({ error: 'consent_required' });
    row.consent_accepted = true; row.consent_v = 'pop-consent-v0';                      // older wording is not today's consent
    expect((await scan(session_token)).status).toBe(403);
    row.consent_v = '';                                                                  // no consent version recorded at all
    expect((await scan(session_token)).status).toBe(403);
    expect(providerCalls).toBe(0);
  });

  it('STOP revokes the proof at once; DELETE too; a fresh handshake afterwards works again', async () => {
    const { session_token } = await bound();
    expect((await scan(session_token)).status).toBe(200); providerCalls = 0;
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 1000);
    await inbound('stop');
    expect(await (await scan(session_token)).json()).toMatchObject({ error: 'proof_revoked' });
    expect(providerCalls).toBe(0);
    vi.setSystemTime(Date.now() + 1000);
    const again = await bound(); expect((await scan(again.session_token)).status).toBe(200);
    expect((await scan(session_token)).status).toBe(403);                              // the revoked session stays dead
    vi.setSystemTime(Date.now() + 1000); await inbound('DELETE');
    expect((await scan(again.session_token)).status).toBe(403);
  });

  it('a deleted proof row is refused', async () => {
    const { session_token } = await bound(); ledger.proofs.delete(await proofSid(BASE_ENV, session_token));
    expect((await scan(session_token)).status).toBe(403); expect(providerCalls).toBe(0);
  });

  it('direct API and queued-job bypass: the server secret alone, a wa_id alone, or a stale answer never reach a provider; the gate is re-run at execution', async () => {
    const { session_token } = await bound();
    const early = await checkPossession(BASE_ENV, { token: session_token, target: WA });
    expect(early.ok).toBe(true);
    await inbound('STOP');                                                              // revoked while "queued"
    const late = await checkPossession(BASE_ENV, { token: session_token, target: WA });   // the worker re-validates when it runs
    expect(late).toMatchObject({ ok: false, error: 'proof_revoked' });
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA }, srv)).status).toBe(403);
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA, session_token }, {})).status).toBe(401);   // and the server secret is still required
    expect(providerCalls).toBe(0);
  });
});

describe('MPC-7902: fail closed', () => {
  it('store outage at the gate: 503, no provider call', async () => {
    const { session_token } = await bound();
    failLedger = (fn) => fn === 'mpt_ledger_pop_check';
    const r = await scan(session_token); expect(r.status).toBe(503); expect((await r.json() as any).error).toBe('proof_store_unavailable');
    expect(providerCalls).toBe(0);
  });

  it('revocation store unreadable: 503, not "not revoked"', async () => {
    const { session_token } = await bound();
    checkShape = (b) => { const { revoked_at_ms, ...rest } = b; return rest; };   // the revocation half of the answer is missing: an outage, never "not revoked"
    expect((await scan(session_token)).status).toBe(503); expect(providerCalls).toBe(0);
  });

  it('partial-write failure: the proof write fails => no success reply, no proof, the challenge is spent', async () => {
    const { j } = await challenge();
    failLedger = (fn) => fn === 'mpt_ledger_pop_bind';                                   // the proof write fails
    await inbound(j.code);
    expect(replies.at(-1)!.body).toMatch(/could not complete/);
    expect(replies.some((r) => r.body.startsWith('Verified.'))).toBe(false);
    expect(persisted('pop_sess:')).toHaveLength(0);
    expect((await scan(j.session_token)).status).toBe(403);
  });

  it('store outage while redeeming or creating: no binding, no challenge', async () => {
    const { j } = await challenge();
    fail = (m) => m === 'DELETE';
    await inbound(j.code); expect(persisted('pop_sess:')).toHaveLength(0);
    fail = (m) => m === 'POST';
    expect((await challenge()).r.status).toBe(503);
  });

  it('no HMAC secret (or a short one): nothing is created, redeemed or accepted', async () => {
    const env = { ...BASE_ENV, POP_HMAC_SECRET: undefined };
    expect((await challenge(undefined, env)).r.status).toBe(503);
    expect((await challenge(undefined, { ...BASE_ENV, POP_HMAC_SECRET: 'short' })).r.status).toBe(503);
    expect((await scan('A'.repeat(43), WA, env)).status).toBe(503);
    expect(providerCalls).toBe(0);
  });
});

describe('MPC-7902: feature flag OFF means no phone-number scan on web', () => {
  it('every web path is closed with the flag unset, "0", or anything but "1" — including with a valid proof already stored', async () => {
    const { session_token } = await bound();
    for (const flag of [undefined, '0', 'true', '']) {
      const env = { ...BASE_ENV, PHONE_SCAN_WEB_ENABLED: flag };
      expect((await challenge(undefined, env)).r.status).toBe(403);
      expect((await call('/api/pop/status', { session_token }, web, env)).status).toBe(403);
      const r = await scan(session_token, WA, env); expect(r.status).toBe(403); expect((await r.json() as any).error).toBe('phone_scan_disabled');
    }
    expect(providerCalls).toBe(0);                                                       // OFF never degrades to an unverified direct scan
  });

  it('with the flag off an inbound code binds nothing', async () => {
    const { j } = await challenge();
    await inbound(j.code, WA, { env: { ...BASE_ENV, PHONE_SCAN_WEB_ENABLED: '0' } });
    expect(persisted('pop_sess:')).toHaveLength(0);
  });
});

describe('MPC-7902: no leakage', () => {
  it('logs and error paths never contain codes, session tokens, the wa_id, the HMAC secret or the server secret', async () => {
    const { j } = await challenge(); await inbound('MPT-AAAA-BBBB'); await inbound(j.code); await scan(j.session_token); await scan('B'.repeat(43), OTHER);
    failLedger = (fn) => fn === 'mpt_ledger_pop_check'; await scan(j.session_token); failLedger = () => false;
    await inbound('stop');
    const all = logs.join('\n');
    for (const secret of [j.code, j.session_token, WA, OTHER, HMAC, SECRET, 'app-secret']) expect(all).not.toContain(secret);
  });

  it('denials never echo the wa_id or the expected target', async () => {
    const { session_token } = await bound();
    const bodies = [await (await scan(session_token, OTHER)).text(), await (await scan('A'.repeat(43))).text()];
    for (const b of bodies) { expect(b).not.toContain(WA); expect(b).not.toContain(OTHER); }
  });
});

describe('MPC-8737: the proof lives in the data-point ledger, not in mpt_conversation_state', () => {
  it('a binding writes ONE ledger bind call and no pop_sess / pop_rev key to the interim store', async () => {
    const { session_token } = await bound(); await inbound('STOP');
    expect(rpcCalls.filter((c) => c.fn === 'mpt_ledger_pop_bind')).toHaveLength(1);
    expect(rpcCalls.filter((c) => c.fn === 'mpt_ledger_pop_revoke')).toHaveLength(1);
    expect([...rows.keys()].filter((k) => k.startsWith('pop_sess:') || k.startsWith('pop_rev:'))).toEqual([]);
    expect(ledger.proofs.has(await proofSid(BASE_ENV, session_token))).toBe(true);
  });

  it('the bind call carries the HMAC of the session, the digits of the sender, the consent and a 60 minute life; never the token or the code', async () => {
    const { session_token, code } = await bound();
    const call = rpcCalls.find((c) => c.fn === 'mpt_ledger_pop_bind')!.args;
    expect(call.p_sid).toBe(await proofSid(BASE_ENV, session_token));
    expect(call.p_sid).toMatch(/^[0-9a-f]{64}$/);
    expect(call).toMatchObject({ p_wa: WA, p_consent_v: CONSENT_VERSION, p_consent_accepted: true, p_ttl_seconds: 3600 });
    expect(call.p_msg).toMatch(/^[0-9a-f]{64}$/);                                       // the provider message id is hashed
    const wire = JSON.stringify(rpcCalls);
    expect(wire).not.toContain(session_token); expect(wire).not.toContain(code); expect(wire).not.toContain(HMAC);
  });

  it('STOP sends the sender digits and a 24 hour revocation life to the ledger', async () => {
    await bound(); await inbound('stop');
    const call = rpcCalls.find((c) => c.fn === 'mpt_ledger_pop_revoke')!.args;
    expect(call).toMatchObject({ p_wa: WA, p_ttl_seconds: 86400 });
    expect(typeof call.p_at_ms).toBe('number');
  });

  it('the gate reads the ledger on EVERY call (no caching of an answer)', async () => {
    const { session_token } = await bound();
    rpcCalls.length = 0;
    await scan(session_token); await scan(session_token);
    expect(rpcCalls.filter((c) => c.fn === 'mpt_ledger_pop_check')).toHaveLength(2);
  });

  it('a malformed ledger answer is an outage (503), never "no proof" and never a pass', async () => {
    const { session_token } = await bound();
    for (const shape of [(b: any) => ({ ...b, proof: { ...b.proof, wa: 85212345678 } }), (b: any) => ({ ...b, revoked_at_ms: '1' }), () => ({}), () => null, () => []]) {
      checkShape = shape;
      const r = await scan(session_token); expect(r.status).toBe(503); expect((await r.json() as any).error).toBe('proof_store_unavailable');
    }
    expect(providerCalls).toBe(0);
  });

  it('no service-role key: bind, read and revoke all fail closed', async () => {
    const env = { ...BASE_ENV, SUPABASE_SERVICE_ROLE_KEY: undefined };
    const { j } = await challenge(); await inbound(j.code, WA, { env });
    expect(replies.some((r) => r.body.startsWith('Verified.'))).toBe(false);
    expect((await scan('A'.repeat(43), WA, env)).status).toBe(503);
    expect(providerCalls).toBe(0);
  });

  it('with the flag OFF the Worker makes no ledger call at all', async () => {
    const env = { ...BASE_ENV, PHONE_SCAN_WEB_ENABLED: '0' };
    const { session_token } = await bound(); rpcCalls.length = 0;
    await scan(session_token, WA, env); await call('/api/pop/status', { session_token }, web, env); await inbound('MPT-AAAA-BBBB', WA, { env });
    expect(rpcCalls).toEqual([]);
  });

  it('a proof survives a Worker restart (nothing about it is held in memory): a new isolate with the same ledger still verifies', async () => {
    const { session_token } = await bound();
    vi.resetModules();
    const fresh = await import('./pop.ts');
    expect((await fresh.checkPossession(BASE_ENV, { token: session_token, target: WA })).ok).toBe(true);
  });
});
