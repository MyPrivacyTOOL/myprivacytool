// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const SECRET = 'dd-secret';
const WA = '85212345678';
const ENV = { PHONE_SCAN_WEB_ENABLED: '1', POP_HMAC_SECRET: 'p'.repeat(40), DEEP_DIVE_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'svc', META_APP_SECRET: 'app-secret',
  WHATSAPP_PHONE_NUMBER_ID: '999', META_WHATSAPP_KEY: 'tok', RAPIDAPI_KEY: 'rk', RAPIDAPI_WHATSAPP_HOST: 'wa.example', SPAM_API_URL: 'https://spam.example/v1', SPAM_API_KEY: 'sk' };

let msgSeq = 0;
let ledgerProofs: Map<string, any>; let ledgerRevs: Map<string, number>;   // MPC-8737: the PoP proof lives in the ledger (RPC stand-in below)
let metaBodies: any[]; let docs: Record<string, any>; let calls: string[]; let metaStatus: number; let spamMode: 'ok' | 'hang'; let engagement: any[]; let interactions: any[]; let tuning: any[];

beforeEach(() => {
  ledgerProofs = new Map(); ledgerRevs = new Map();
  docs = { [`whatsapp:${WA}`]: { profileName: 'Alex' } }; msgSeq = 0; calls = []; metaBodies = []; metaStatus = 200; spamMode = 'ok'; engagement = []; interactions = []; tuning = [];
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input); calls.push(url);
    const rpc = /\/rest\/v1\/rpc\/(mpt_ledger_pop_\w+)/.exec(url)?.[1];
    if (rpc) {   // the ledger's three PoP RPCs, same contract as the SQL (supabase/migrations/20261028120000_mpc_8737_data_point_ledger_v1.sql)
      const a = JSON.parse(init.body);
      if (rpc === 'mpt_ledger_pop_bind') { ledgerProofs.set(a.p_sid, { wa: a.p_wa, bound_at_ms: a.p_bound_at_ms, inbound_ts: a.p_inbound_ts, consent_v: a.p_consent_v, consent_accepted: a.p_consent_accepted, exp: a.p_bound_at_ms + a.p_ttl_seconds * 1000 }); return new Response('true'); }
      if (rpc === 'mpt_ledger_pop_revoke') { ledgerRevs.set(a.p_wa, a.p_at_ms); return new Response('true'); }
      const p = ledgerProofs.get(a.p_sid); const live = p && p.exp > Date.now() ? p : null;
      return new Response(JSON.stringify({ proof: live ? { wa: live.wa, bound_at_ms: live.bound_at_ms, inbound_ts: live.inbound_ts, consent_v: live.consent_v, consent_accepted: live.consent_accepted } : null, revoked_at_ms: live ? ledgerRevs.get(live.wa) ?? null : null }));
    }
    if (url.includes('/rest/v1/mpt_conversation_state')) {   // scan / conversation state (Supabase)
      if (init.method === 'POST') {
        const row = JSON.parse(init.body);
        if (String(init.headers?.Prefer).includes('ignore-duplicates')) { if (row.key in docs) return new Response('[]'); docs[row.key] = row.state; return new Response(JSON.stringify([{ key: row.key }])); }
        docs[row.key] = row.state; return new Response('', { status: 201 });
      }
      if (init.method === 'DELETE') {
        const m = /key=eq\.([^&]+)/.exec(url);   // atomic take of one row, else the purge of expired rows
        if (!m) return new Response('', { status: 200, headers: { 'Content-Range': '*/0' } });
        const k = decodeURIComponent(m[1]); const had = docs[k]; delete docs[k];
        return new Response(JSON.stringify(had ? [{ state: had }] : []));
      }
      const key = decodeURIComponent(/key=eq\.([^&]+)/.exec(url)![1]);
      return new Response(JSON.stringify(docs[key] ? [{ state: docs[key] }] : []));
    }
    if (url.startsWith('https://wa.example')) return new Response(JSON.stringify({ profile_pic_url: 'https://pic', is_business: false }));
    if (url.startsWith('https://spam.example')) { if (spamMode === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))); return new Response(JSON.stringify({ flags: 0 })); }
    if (url.includes('graph.facebook.com')) { metaBodies.push(JSON.parse(init.body)); } if (url.includes('graph.facebook.com')) return metaStatus === 200 ? new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] })) : new Response(JSON.stringify({ error: { code: 131047, message: 're-engagement' } }), { status: 400 });
    if (url.includes('/rest/v1/mpt_user_engagement')) { engagement.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    if (url.includes('/rest/v1/mpt_hexagon_interactions')) { interactions.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    if (url.includes('/rest/v1/osint_engine_tuning_log')) { tuning.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    throw new Error('unexpected fetch ' + url);
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = (path: string, body?: any, headers: Record<string, string> = {}, method = 'POST', env = ENV) =>
  worker.fetch(new Request('https://x' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers }), env, { waitUntil() {} });
async function whatsapp(text: string, from = WA) {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Alex' } }], messages: [{ id: `wamid.${++msgSeq}`, from, timestamp: '1760000001', text: { body: text } }] } }] }] });
  const hmac = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new TextEncoder().encode('app-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(raw));
  const sig = 'sha256=' + [...new Uint8Array(hmac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return worker.fetch(new Request('https://x/webhook/whatsapp', { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': sig } }), ENV, { waitUntil() {} });
}
const srv = { 'X-Webhook-Secret': SECRET };
const web = { Origin: 'https://myprivacytool.io' };

/** The real handshake: the web asks for a challenge, the person sends the code from their own number, then the scan starts with that session. */
async function verified(wa = WA) {
  const nMeta = metaBodies.length, nCalls = calls.length;
  const c = await (await call('/api/pop/challenge', { target: wa, consent: true }, web)).json() as any;
  await whatsapp(c.code, wa);
  metaBodies.splice(nMeta); calls.splice(nCalls);   // the handshake's own confirmation reply is not part of what these tests count
  return c.session_token as string;
}
async function start() { const session_token = await verified(); const r = await call('/api/scan/start-deep-dive', { wa_id: WA, session_token }, srv); return { r, j: await r.json() as any }; }

describe('deep dive flow', () => {
  it('start: needs the secret, fails closed, needs PoP', async () => {
    const tok = await verified();
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA, session_token: tok })).status).toBe(401);
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA, session_token: tok }, srv, 'POST', { ...ENV, DEEP_DIVE_SECRET: undefined })).status).toBe(401);
    expect((await call('/api/scan/start-deep-dive', { wa_id: '85299999999' }, srv)).status).toBe(403);
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA }, srv)).status).toBe(403);   // a number that has messaged us is not enough without the bound session
    expect(calls.some((u) => u.includes('wa.example') || u.includes('spam.example'))).toBe(false);   // no provider saw an unverified number
  });

  it('start: populates hexagons; unconfigured breach DB is not_checked; wa_id is not returned', async () => {
    const { r, j } = await start();
    expect(r.status).toBe(200);
    const by = (id: string) => j.hexagons.find((h: any) => h.id === id);
    expect(by('hex_security_spam_flag')).toMatchObject({ status: 'checked', data: 'Clean' });
    expect(by('hex_security_breach_count')).toMatchObject({ status: 'not_checked', data: null });
    expect(JSON.stringify(j)).not.toContain(WA);
  });

  it('start: a hanging spam registry is cut off and reported not_checked', async () => {
    const session_token = await verified();
    spamMode = 'hang'; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = call('/api/scan/start-deep-dive', { wa_id: WA, session_token }, srv); let done = false; p.then(() => { done = true; });
    for (let i = 0; i < 400 && !done; i++) { await vi.advanceTimersByTimeAsync(500); for (let k = 0; k < 5; k++) await new Promise((res) => setImmediate(res)); }   // real crypto/IO between ticks
    const r = await p; vi.useRealTimers();
    expect((await r.json() as any).hexagons.find((h: any) => h.id === 'hex_security_spam_flag')).toMatchObject({ status: 'not_checked', data: null });
  });

  it('deep-dive page data: the scan owner link returns the findings (never the wa_id); unknown scan 404, bad origin 403', async () => {
    const { j } = await start();
    const r = await call(`/api/scan/deep-dive?scan_id=${j.scan_id}`, undefined, web, 'GET');
    const out = await r.json() as any;
    expect(r.status).toBe(200);
    expect(out.finalized).toBe(false);
    expect(out.hexagons.map((h: any) => h.id)).toEqual(j.hexagons.map((h: any) => h.id));
    expect(JSON.stringify(out)).not.toContain(WA);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect((await call('/api/scan/deep-dive?scan_id=00000000-0000-4000-8000-000000000000', undefined, web, 'GET')).status).toBe(404);
    expect((await call(`/api/scan/deep-dive?scan_id=${j.scan_id}`, undefined, { Origin: 'https://evil.example' }, 'GET')).status).toBe(403);
  });

  it('end to end: start -> interact -> score -> finalize (no Meta call) -> RESULTS replies with a text message', async () => {
    const { j } = await start(); const scan_id = j.scan_id;
    // photo is a 0.85 "checked" finding, so the user may dispute it
    let r = await call('/api/scan/hexagon-interaction', { scan_id, hexagon_id: 'hex_contact_profile_pic', action: 'dispute' }, web);
    expect(r.status).toBe(200); expect((await r.json() as any).hexagon.status).toBe('disputed');
    // learning loop: a dispute is written to BOTH tables, with the provider, and carries no wa_id or finding value
    expect(interactions).toEqual([{ scan_session_id: scan_id, hexagon_id: 'hex_contact_profile_pic', user_action: 'disputed', original_confidence_score: 0.85, osint_source: expect.any(String) }]);
    expect(tuning).toEqual([{ hexagon_id: 'hex_contact_profile_pic', osint_source: interactions[0].osint_source, action_type: 'dispute_rate' }]);
    expect(JSON.stringify([interactions, tuning])).not.toContain(WA);
    r = await call('/api/scan/hexagon-interaction', { scan_id, hexagon_id: 'hex_contact_profile_pic', action: 'confirm' }, web);
    expect(r.status).toBe(409);                                                   // already answered
    expect(interactions).toHaveLength(1);                                         // a refused answer is not persisted
    r = await call(`/api/scan/final-risk-score?scan_id=${scan_id}`, undefined, web, 'GET');
    expect(await r.json()).toMatchObject({ verified_exposure_count: 1, confirmed_hexagon_ids: ['hex_contact_display_name'] });   // only the Meta display name remains an exposure; the disputed photo is out
    const score = (await (await call(`/api/scan/final-risk-score?scan_id=${scan_id}`, undefined, web, 'GET')).json() as any).score;
    expect(score).toBe(16.7);                                                  // 1 verified exposure over this scan's 6 hexagons
    r = await call('/api/scan/finalize', { scan_id, verified_exposure_count: 99 }, web);   // a count from the browser is ignored
    expect(await r.json()).toMatchObject({ success: true, verified_exposure_count: 1 });
    expect(engagement[0]).toEqual({ session_id: scan_id, channel: 'whatsapp', full_scan_completed: true });
    expect(JSON.stringify(engagement)).not.toContain(WA);
    expect(await (await call('/api/scan/finalize', { scan_id }, web)).json()).toMatchObject({ already_sent: true });
    expect(calls.some((u) => u.includes('graph.facebook.com'))).toBe(false);      // finalize sends nothing
    expect((await call('/api/scan/hexagon-interaction', { scan_id, hexagon_id: 'hex_security_spam_flag', action: 'dispute' }, web)).status).toBe(409);

    // the person asks for it: plain text, to their own number
    r = await whatsapp('  results ');
    expect(r.status).toBe(200);
    expect(metaBodies).toHaveLength(1);
    expect(metaBodies[0]).toMatchObject({ messaging_product: 'whatsapp', to: WA, type: 'text' });
    expect(metaBodies[0].text.body).toMatch(/^Your MPT Deep Dive is complete\. ✅ Verified: 1 exposures\. ⚠️ Action required: \d+ items\. Tap here for your secure dashboard: https:\/\/myprivacytool\.io\/scan\/deep-dive\?scan=/);
    expect(metaBodies[0].text.body).toContain(scan_id);
  });

  it('RESULTS / STATUS before the scan is finished, or with no scan, gets the polite processing text', async () => {
    await whatsapp('RESULTS');                       // no scan at all
    await start();
    await whatsapp('status');                        // started, not finalized
    expect(metaBodies.map((b) => b.text.body)).toEqual(Array(2).fill('Your Deep Dive is still processing. Please check back in a few minutes.'));
    expect(metaBodies.every((b) => b.type === 'text')).toBe(true);
  });

  it('RESULTS after the scan expired says so and points to a new scan', async () => {
    const { j } = await start(); await call('/api/scan/finalize', { scan_id: j.scan_id }, web);
    docs[`deepdive:${j.scan_id}`].expires_at = Date.now() - 1;
    await whatsapp('RESULTS');
    expect(metaBodies[0].text.body).toContain('expired');
  });

  it('RESULTS only reads the sender\'s own scan', async () => {
    const { j } = await start(); await call('/api/scan/finalize', { scan_id: j.scan_id }, web);
    await whatsapp('RESULTS', '85299999999');
    expect(metaBodies[0].text.body).toBe('Your Deep Dive is still processing. Please check back in a few minutes.');
    expect(metaBodies[0].to).toBe('85299999999');
  });

  it('the template endpoint is gone', async () => {
    expect((await call('/api/whatsapp/notify-complete', { wa_id: WA }, srv)).status).toBe(404);
    expect(calls.some((u) => u.includes('graph.facebook.com'))).toBe(false);
  });

  it('browser endpoints: bad origin, unknown / malformed / expired scan_id', async () => {
    const { j } = await start();
    expect((await call('/api/scan/finalize', { scan_id: j.scan_id }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/api/scan/finalize', { scan_id: 'nope' }, web)).status).toBe(404);
    expect((await call('/api/scan/finalize', { scan_id: crypto.randomUUID() }, web)).status).toBe(404);
    docs[`deepdive:${j.scan_id}`].expires_at = Date.now() - 1;
    expect((await call(`/api/scan/final-risk-score?scan_id=${j.scan_id}`, undefined, web, 'GET')).status).toBe(404);
  });
});
