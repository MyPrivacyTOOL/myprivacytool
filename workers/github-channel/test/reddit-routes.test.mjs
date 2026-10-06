// Reddit channel routes end to end (MPC-116), with GitHub's routes in the same Worker and the same token table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../index.js';
import { sign } from '../lib/oauth.js';
import { CACHE_TTL_SECONDS } from '../lib/cache.js';
import { saveToken, loadTokens } from '../lib/store.js';
import { verifyReceipt } from '../lib/papit.js';

const ACCESS = 'rd_PLAINTEXT_ACCESS_TOKEN_1';
const REFRESH = 'rd_PLAINTEXT_REFRESH_TOKEN_1';
const ACCESS2 = 'rd_PLAINTEXT_ACCESS_TOKEN_2';
const SECRET_HANDLE = 'secret_handle_zz';
const noLimit = (fn) => fn();
const clock = { t: Date.parse('2026-10-06T12:00:00Z') };
const now = () => clock.t;
const secs = () => Math.floor(clock.t / 1000);

const baseEnv = () => {
  const store = new Map(); const ttls = [];
  return {
    GITHUB_CLIENT_ID: 'gcid', GITHUB_CLIENT_SECRET: 'gsec', STATE_SIGNING_KEY: 's'.repeat(32),
    ENCRYPTION_KEY: 'c3'.repeat(32), ENCRYPTION_KEY_VERSION: '1',
    SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk',
    REDIRECT_URI: 'https://w.test/oauth/github/callback',
    ALLOWED_ORIGIN: 'https://app.test', SUCCESS_REDIRECT: 'https://app.test/connect/github',
    REDDIT_CLIENT_ID: 'rcid', REDDIT_CLIENT_SECRET: 'rsec', REDDIT_REDIRECT_URI: 'https://w.test/oauth/reddit/callback',
    REDDIT_USER_AGENT: 'MyPrivacyTOOL-test/1.0', REDDIT_SUCCESS_REDIRECT: 'https://app.test/connect/reddit',
    PROFILE_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v, o) => { store.set(k, v); ttls.push(o?.expirationTtl); }, delete: async (k) => { store.delete(k); }, _store: store, _ttls: ttls },
  };
};

/** In-memory Supabase REST (rows keyed provider|user_id) + Reddit API. */
function fakeNetwork({ refreshResponse } = {}) {
  const rows = new Map();
  const seen = { bodies: [], refreshCalls: 0, revokeCalls: [], redditAuth: [], redditUA: [], tokenReqHeaders: [] };
  const state = { validToken: ACCESS };
  const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchFn = async (u, init = {}) => {
    u = String(u);
    if (init.body) seen.bodies.push(String(init.body));
    if (u === 'https://www.reddit.com/api/v1/access_token') {
      seen.tokenReqHeaders.push(init.headers);
      if (String(init.body).includes('grant_type=refresh_token')) { seen.refreshCalls++; return ok(refreshResponse ?? { access_token: ACCESS2, expires_in: 3600, scope: 'identity read history' }); }
      return ok({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: 'identity read history' });
    }
    if (u === 'https://www.reddit.com/api/v1/revoke_token') { seen.revokeCalls.push(String(init.body)); return new Response(null, { status: 204 }); }
    if (u.startsWith('https://sb.test/rest/v1/channel_tokens')) {
      if (init.method === 'POST') { const r = JSON.parse(init.body); rows.set(`${r.provider}|${r.user_id}`, r); return new Response(null, { status: 201 }); }
      const key = () => `${/provider=eq\.([^&]+)/.exec(u)[1]}|${decodeURIComponent(/user_id=eq\.([^&]+)/.exec(u)[1])}`;
      if (init.method === 'GET') return ok(rows.has(key()) ? [rows.get(key())] : []);
      if (init.method === 'DELETE') { rows.delete(key()); return new Response(null, { status: 204 }); }
    }
    if (u.startsWith('https://oauth.reddit.com/')) {
      seen.redditAuth.push(init.headers.Authorization); seen.redditUA.push(init.headers['User-Agent']);
      if (init.headers.Authorization !== `Bearer ${state.validToken}`) return new Response('{}', { status: 401 });
      if (u.endsWith('/api/v1/me')) return ok({ id: 'r3dd1t', name: SECRET_HANDLE, created_utc: secs() - 400 * 86400, total_karma: 99, verified: true });
      if (u.includes('/comments')) return ok({ data: { children: [
        { data: { subreddit: 'privacy', body: 'UNIQUE_RAW_BODY encryption encryption metadata, mail jane@example.com', score: 5, controversiality: 0, created_utc: secs() - 86400 } },
        { data: { subreddit: 'privacy', body: `thanks great encryption tooling from ${SECRET_HANDLE}`, score: 3, controversiality: 0, created_utc: secs() - 2 * 86400 } },
        { data: { subreddit: 'typescript', body: 'generics inference helpful', score: 1, controversiality: 0, created_utc: secs() - 3 * 86400 } },
      ] } });
      if (u.includes('/submitted')) return ok({ data: { children: [{ data: { subreddit: 'privacy', title: 'UNIQUE_RAW_TITLE fingerprinting study', score: 9, created_utc: secs() - 10 * 86400 } }] } });
    }
    throw new Error('unexpected request ' + u);
  };
  return { fetchFn, rows, seen, state };
}

async function connect(env, net) {
  const state = 'rd-st4te';
  const stateCookie = await sign({ state, exp: clock.t + 60_000 }, env.STATE_SIGNING_KEY);
  const req = new Request(`https://w.test/oauth/reddit/callback?code=c&state=${state}`, { headers: { Cookie: `mpt_rd_oauth=${stateCookie}` } });
  const res = await handle(req, env, { fetchFn: net.fetchFn, now, limiter: noLimit });
  const session = /mpt_rd_session=([^;]+)/.exec(res.headers.getSetCookie().join('\n'))?.[1];
  return { res, session };
}
const behaviorReq = (session) => new Request('https://w.test/channels/reddit/behavior', { headers: { Cookie: `mpt_rd_session=${session}`, Origin: 'https://app.test' } });
const get = (env, net, req) => handle(req, env, { fetchFn: net.fetchFn, now, limiter: noLimit });

test('not configured: Reddit routes answer 503 and GitHub is unaffected', async () => {
  const env = baseEnv(); delete env.REDDIT_CLIENT_SECRET;
  for (const path of ['/oauth/reddit/start', '/oauth/reddit/callback', '/channels/reddit/behavior']) {
    const res = await handle(new Request(`https://w.test${path}`), env, { now });
    assert.equal(res.status, 503, path); assert.equal((await res.json()).error, 'reddit_not_configured');
  }
  assert.equal((await handle(new Request('https://w.test/health'), env, { now })).status, 200);
  assert.equal((await handle(new Request('https://w.test/oauth/github/start'), env, { now })).status, 302);
  assert.equal((await handle(new Request('https://w.test/oauth/reddit/nope'), env, { now })).status, 404);
});

test('start: redirects to Reddit with the minimum scopes, permanent duration and a signed state cookie', async () => {
  const res = await handle(new Request('https://w.test/oauth/reddit/start'), baseEnv(), { now });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.reddit.com/api/v1/authorize');
  assert.equal(loc.searchParams.get('scope'), 'identity read history');
  assert.equal(loc.searchParams.get('duration'), 'permanent');
  assert.equal(loc.searchParams.get('client_id'), 'rcid');
  assert.match(res.headers.get('Set-Cookie'), /mpt_rd_oauth=.*HttpOnly; Secure; SameSite=Lax/);
});

test('callback: state mismatch is rejected before any token exchange', async () => {
  const env = baseEnv();
  const cookie = await sign({ state: 'good', exp: clock.t + 1000 }, env.STATE_SIGNING_KEY);
  const res = await handle(new Request('https://w.test/oauth/reddit/callback?state=bad&code=c', { headers: { Cookie: `mpt_rd_oauth=${cookie}` } }), env,
    { fetchFn: async () => { throw new Error('must not be called'); }, now });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('Location'), /channel_error=invalid_state/);
});

test('callback: stores ONLY ciphertext (provider=reddit), sets a session, never stores the username', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const { res, session } = await connect(env, net);
  assert.equal(res.status, 302); assert.ok(session);
  assert.equal(res.headers.get('Location'), 'https://app.test/connect/reddit');
  const row = net.rows.get('reddit|r3dd1t');
  assert.equal(row.provider, 'reddit'); assert.equal(row.user_id, 'r3dd1t');
  assert.match(row.access_token_enc, /^v1\./); assert.match(row.refresh_token_enc, /^v1\./);
  assert.equal(row.scope, 'identity read history'); assert.ok(row.expires_at);
  const sent = net.seen.bodies.filter((b) => b.includes('user_id')).join('\n');
  assert.ok(sent && !sent.includes(ACCESS) && !sent.includes(REFRESH), 'plaintext token reached the DB request');
  assert.ok(!JSON.stringify([...net.rows.values()]).includes(SECRET_HANDLE), 'username stored');
  assert.equal(net.seen.tokenReqHeaders[0].Authorization, `Basic ${btoa('rcid:rsec')}`);
});

test('behavior: 401 without a session; 200 sanitized PaPIT with one; no raw text, handle or id leaks', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  assert.equal((await get(env, net, new Request('https://w.test/channels/reddit/behavior'))).status, 401);
  const { session } = await connect(env, net);
  const res = await get(env, net, behaviorReq(session));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.test');
  assert.match(res.headers.get('X-PaPIT-Sanitization-Receipt'), /^[0-9a-f]{64}$/);
  const body = await res.json();
  assert.equal(body.source_channel, 'reddit');
  assert.ok(await verifyReceipt(body));
  assert.ok(body.behavioral.interests.includes('encryption'));
  assert.equal(body.privacy_boundaries.raw_content_stored, false);
  const dump = JSON.stringify(body);
  for (const leak of ['UNIQUE_RAW', 'jane', 'example.com', SECRET_HANDLE, 'r3dd1t']) assert.ok(!dump.includes(leak), leak);
  assert.ok(net.seen.redditUA.every((ua) => ua === 'MyPrivacyTOOL-test/1.0'));
});

test('24h cache: HIT within the TTL (no Reddit calls), MISS after it; GitHub and Reddit cache keys are separate', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  clock.t = Date.parse('2026-10-06T12:00:00Z');
  const { session } = await connect(env, net);
  const first = await get(env, net, behaviorReq(session));
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  const calls = net.seen.redditAuth.length; assert.ok(calls >= 3);
  assert.deepEqual([...env.PROFILE_CACHE._store.keys()], ['papit:reddit:r3dd1t']);

  clock.t += (CACHE_TTL_SECONDS - 60) * 1000;
  const hit = await get(env, net, behaviorReq(session));
  assert.equal(hit.headers.get('X-Cache'), 'HIT');
  assert.equal(net.seen.redditAuth.length, calls);
  assert.deepEqual(await hit.json(), await first.json());

  clock.t += 120 * 1000;
  assert.equal((await get(env, net, behaviorReq(session))).headers.get('X-Cache'), 'MISS');
  assert.ok(env.PROFILE_CACHE._ttls.every((t) => t === 86400));
});

test('expired access token (401): refreshes once, keeps the SAME refresh token (Reddit does not rotate), retries, saves ciphertext', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  clock.t = Date.parse('2026-10-06T12:00:00Z');
  const { session } = await connect(env, net);
  net.state.validToken = ACCESS2; // the stored ACCESS token has expired
  const before = net.rows.get('reddit|r3dd1t');

  const res = await get(env, net, behaviorReq(session));
  assert.equal(res.status, 200);
  assert.equal(net.seen.refreshCalls, 1);
  const row = net.rows.get('reddit|r3dd1t');
  assert.notEqual(row.access_token_enc, before.access_token_enc);
  assert.match(row.access_token_enc, /^v1\./);
  assert.ok(row.refresh_token_enc, 'refresh token kept');
  assert.ok(!net.seen.bodies.join('\n').includes(ACCESS2), 'new access token sent to the DB in plaintext');
  // the kept refresh token still decrypts to the original
  assert.equal((await loadTokens(env, 'r3dd1t', net.fetchFn, 'reddit')).refreshToken, REFRESH);
  // next cache miss uses the new token without refreshing again
  await env.PROFILE_CACHE.delete('papit:reddit:r3dd1t');
  assert.equal((await get(env, net, behaviorReq(session))).status, 200);
  assert.equal(net.seen.refreshCalls, 1);
});

test('refresh rejected: row deleted, client told to reauthorize', async () => {
  const env = baseEnv(); const net = fakeNetwork({ refreshResponse: { error: 'invalid_grant' } });
  const { session } = await connect(env, net);
  net.state.validToken = 'something-else';
  const res = await get(env, net, behaviorReq(session));
  assert.equal(res.status, 401); assert.equal((await res.json()).error, 'reauthorize');
  assert.equal(net.rows.size, 0);
});

test('DELETE revokes: foreign origin rejected; row gone, cache cleared, token revoked at Reddit, session cleared', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const { session } = await connect(env, net);
  await get(env, net, behaviorReq(session)); // populate cache
  const del = (origin) => new Request('https://w.test/channels/reddit', { method: 'DELETE', headers: { Cookie: `mpt_rd_session=${session}`, Origin: origin } });
  assert.equal((await get(env, net, del('https://evil.test'))).status, 403);
  assert.equal(net.rows.size, 1);
  const res = await get(env, net, del('https://app.test'));
  assert.deepEqual(await res.json(), { ok: true, revoked_at_reddit: true });
  assert.equal(net.rows.size, 0); assert.equal(env.PROFILE_CACHE._store.size, 0);
  assert.match(net.seen.revokeCalls[0], /token=rd_PLAINTEXT_REFRESH_TOKEN_1/);
  assert.match(net.seen.revokeCalls[0], /token_type_hint=refresh_token/);
  assert.match(res.headers.get('Set-Cookie'), /mpt_rd_session=; Max-Age=0/);
});

test('GitHub and Reddit share one token table without interfering, even with the same account id', async () => {
  const env = baseEnv(); const rows = new Map();
  const fetchFn = async (u, init = {}) => {
    u = String(u);
    if (init.method === 'POST') { const r = JSON.parse(init.body); rows.set(`${r.provider}|${r.user_id}`, r); return new Response(null, { status: 201 }); }
    const k = `${/provider=eq\.([^&]+)/.exec(u)[1]}|${/user_id=eq\.([^&]+)/.exec(u)[1]}`;
    if (init.method === 'GET') return new Response(JSON.stringify(rows.has(k) ? [rows.get(k)] : []), { status: 200 });
    rows.delete(k); return new Response(null, { status: 204 });
  };
  await saveToken(env, { subjectId: '4242', accessToken: 'GH_ACCESS', refreshToken: 'GH_REFRESH' }, fetchFn);
  await saveToken(env, { provider: 'reddit', subjectId: '4242', accessToken: 'RD_ACCESS', refreshToken: 'RD_REFRESH' }, fetchFn);
  assert.equal(rows.size, 2);
  assert.equal((await loadTokens(env, '4242', fetchFn)).accessToken, 'GH_ACCESS');
  assert.equal((await loadTokens(env, '4242', fetchFn, 'reddit')).accessToken, 'RD_ACCESS');
  // a ciphertext copied from the reddit row into the github row fails authentication (provider is in the AAD)
  rows.get('github|4242').access_token_enc = rows.get('reddit|4242').access_token_enc;
  await assert.rejects(loadTokens(env, '4242', fetchFn), /decryption failed/);
});

test('logs never contain tokens, handles or Reddit content', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  try {
    const { session } = await connect(env, net);
    net.state.validToken = ACCESS2;
    await get(env, net, behaviorReq(session));
    await get(env, net, new Request('https://w.test/channels/reddit', { method: 'DELETE', headers: { Cookie: `mpt_rd_session=${session}`, Origin: 'https://app.test' } }));
  } finally { console.log = orig; }
  const all = lines.join('\n');
  assert.ok(lines.length > 0);
  for (const s of [ACCESS, ACCESS2, REFRESH, SECRET_HANDLE, 'UNIQUE_RAW', 'jane@example.com', 'rsec', 'r3dd1t']) assert.ok(!all.includes(s), s);
});

test('connect failure at the store step revokes the freshly issued Reddit token and reports the stage', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const failing = async (u, init) => (String(u).startsWith('https://sb.test') ? new Response('{}', { status: 500 }) : net.fetchFn(u, init));
  const state = 'st'; const cookie = await sign({ state, exp: clock.t + 1000 }, env.STATE_SIGNING_KEY);
  const res = await handle(new Request(`https://w.test/oauth/reddit/callback?code=c&state=${state}`, { headers: { Cookie: `mpt_rd_oauth=${cookie}` } }), env, { fetchFn: failing, now, limiter: noLimit });
  const loc = new URL(res.headers.get('Location'));
  assert.equal(loc.searchParams.get('channel_error'), 'connect_failed'); assert.equal(loc.searchParams.get('stage'), 'store');
  assert.equal(net.seen.revokeCalls.length, 1);
});
