// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const SECRET = 'dd-secret';
const WA = '85212345678';
const ENV = { DEEP_DIVE_SECRET: SECRET, GCP_PROJECT_ID: 'p', FIRESTORE_SA_TOKEN: 't', SUPABASE_SERVICE_ROLE_KEY: 'svc',
  WHATSAPP_PHONE_NUMBER_ID: '999', META_WHATSAPP_KEY: 'tok', RAPIDAPI_KEY: 'rk', RAPIDAPI_WHATSAPP_HOST: 'wa.example', SPAM_API_URL: 'https://spam.example/v1', SPAM_API_KEY: 'sk' };

let docs: Record<string, any>; let calls: string[]; let metaStatus: number; let spamMode: 'ok' | 'hang'; let engagement: any[]; let interactions: any[]; let tuning: any[];
const enc = (o: any) => { const f: any = {}; for (const [k, v] of Object.entries(o)) f[k] = typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { booleanValue: v }; return f; };
const dec = (f: any) => Object.fromEntries(Object.entries<any>(f).map(([k, v]) => [k, v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue)]));

beforeEach(() => {
  docs = { [`whatsapp:${WA}`]: { profileName: 'Alex', inbound_message_timestamp: 1760000000 } }; calls = []; metaStatus = 200; spamMode = 'ok'; engagement = []; interactions = []; tuning = [];
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input); calls.push(url);
    if (url.includes('firestore.googleapis.com')) {
      const key = decodeURIComponent(url.split('/conversations/')[1]);
      if (init.method === 'PATCH') { docs[key] = dec(JSON.parse(init.body).fields); return new Response('{}'); }
      return docs[key] ? new Response(JSON.stringify({ fields: enc(docs[key]) })) : new Response('', { status: 404 });
    }
    if (url.startsWith('https://wa.example')) return new Response(JSON.stringify({ profile_pic_url: 'https://pic', is_business: false }));
    if (url.startsWith('https://spam.example')) { if (spamMode === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))); return new Response(JSON.stringify({ flags: 0 })); }
    if (url.includes('graph.facebook.com')) return metaStatus === 200 ? new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] })) : new Response(JSON.stringify({ error: { code: 131047, message: 're-engagement' } }), { status: 400 });
    if (url.includes('/rest/v1/mpt_user_engagement')) { engagement.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    if (url.includes('/rest/v1/mpt_hexagon_interactions')) { interactions.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    if (url.includes('/rest/v1/osint_engine_tuning_log')) { tuning.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    throw new Error('unexpected fetch ' + url);
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = (path: string, body?: any, headers: Record<string, string> = {}, method = 'POST', env = ENV) =>
  worker.fetch(new Request('https://x' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers }), env, { waitUntil() {} });
const srv = { 'X-Webhook-Secret': SECRET };
const web = { Origin: 'https://myprivacytool.io' };

async function start() { const r = await call('/api/scan/start-deep-dive', { wa_id: WA }, srv); return { r, j: await r.json() as any }; }

describe('deep dive flow', () => {
  it('start: needs the secret, fails closed, needs PoP', async () => {
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA })).status).toBe(401);
    expect((await call('/api/scan/start-deep-dive', { wa_id: WA }, srv, 'POST', { ...ENV, DEEP_DIVE_SECRET: undefined })).status).toBe(401);
    expect((await call('/api/scan/start-deep-dive', { wa_id: '85299999999' }, srv)).status).toBe(403);
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
    spamMode = 'hang'; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = call('/api/scan/start-deep-dive', { wa_id: WA }, srv); await vi.advanceTimersByTimeAsync(5100); const r = await p; vi.useRealTimers();
    expect((await r.json() as any).hexagons.find((h: any) => h.id === 'hex_security_spam_flag')).toMatchObject({ status: 'not_checked', data: null });
  });

  it('deep-dive page data: the scan owner link returns the findings (never the wa_id); unknown scan 404, bad origin 403', async () => {
    const { j } = await start();
    let r = await call(`/api/scan/deep-dive?scan_id=${j.scan_id}`, undefined, web, 'GET');
    const out = await r.json() as any;
    expect(r.status).toBe(200);
    expect(out.finalized).toBe(false);
    expect(out.hexagons.map((h: any) => h.id)).toEqual(j.hexagons.map((h: any) => h.id));
    expect(JSON.stringify(out)).not.toContain(WA);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect((await call('/api/scan/deep-dive?scan_id=00000000-0000-4000-8000-000000000000', undefined, web, 'GET')).status).toBe(404);
    expect((await call(`/api/scan/deep-dive?scan_id=${j.scan_id}`, undefined, { Origin: 'https://evil.example' }, 'GET')).status).toBe(403);
  });

  it('end to end: start -> interact -> score -> finalize -> template with message id, logged, sent once', async () => {
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
    const out = await r.json() as any;
    expect(out).toMatchObject({ success: true, message_id: 'wamid.OK', verified_exposure_count: 1 });
    const send = calls.findIndex((u) => u.includes('graph.facebook.com/v21.0/999/messages')); expect(send).toBeGreaterThan(-1);
    expect(engagement[0]).toMatchObject({ session_id: scan_id, channel: 'whatsapp', whatsapp_notify_message_id: 'wamid.OK', whatsapp_notify_error: null, full_scan_completed: true });
    expect(JSON.stringify(engagement)).not.toContain(WA);
    expect(await (await call('/api/scan/finalize', { scan_id }, web)).json()).toMatchObject({ already_sent: true });
    // still exactly one Graph call after the repeat
    expect(calls.filter((u) => u.includes('graph.facebook.com')).length).toBe(1);
    expect((await call('/api/scan/hexagon-interaction', { scan_id, hexagon_id: 'hex_security_spam_flag', action: 'dispute' }, web)).status).toBe(409);
  });

  it('finalize: Meta error is logged, surfaced, and does not mark the scan sent', async () => {
    const { j } = await start(); metaStatus = 400;
    const r = await call('/api/scan/finalize', { scan_id: j.scan_id }, web);
    expect(r.status).toBe(502); expect((await r.json() as any).error).toContain('131047');
    expect(engagement[0]).toMatchObject({ full_scan_completed: false, whatsapp_notify_message_id: null });
    metaStatus = 200;
    expect((await call('/api/scan/finalize', { scan_id: j.scan_id }, web)).status).toBe(200);   // retry works
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

describe('notify-complete', () => {
  const body = { wa_id: WA, verified_exposure_count: 4, web_dashboard_url: 'https://myprivacytool.io/scan/deep-dive?scan=x' };
  it('401 without the secret; 403 without PoP; 400 on a foreign link; 200 with a message id', async () => {
    expect((await call('/api/whatsapp/notify-complete', body)).status).toBe(401);
    expect((await call('/api/whatsapp/notify-complete', { ...body, wa_id: '85200000000' }, srv)).status).toBe(403);
    expect((await call('/api/whatsapp/notify-complete', { ...body, web_dashboard_url: 'https://evil.example/' }, srv)).status).toBe(400);
    const r = await call('/api/whatsapp/notify-complete', body, srv);
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ success: true, message_id: 'wamid.OK' });
    const sent = calls.filter((u) => u.includes('graph.facebook.com')); expect(sent).toHaveLength(1);
  });
});
