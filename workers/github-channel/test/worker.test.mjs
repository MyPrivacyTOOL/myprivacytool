import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../index.js';
import { sign } from '../lib/oauth.js';
import { CACHE_TTL_SECONDS } from '../lib/cache.js';

const ACCESS_TOKEN = 'gho_PLAINTEXT_ACCESS_TOKEN_1234567890';
const REFRESH_TOKEN = 'ghr_PLAINTEXT_REFRESH_TOKEN_1234567890';

const baseEnv = () => {
  const store = new Map();
  const ttls = [];
  return {
    GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csec', STATE_SIGNING_KEY: 's'.repeat(32),
    ENCRYPTION_KEY: 'c3'.repeat(32), ENCRYPTION_KEY_VERSION: '1',
    SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk',
    REDIRECT_URI: 'https://w.test/oauth/github/callback',
    ALLOWED_ORIGIN: 'https://app.test,https://www.app.test', SUCCESS_REDIRECT: 'https://app.test/?channel=github',
    PROFILE_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v, opts) => { store.set(k, v); ttls.push(opts?.expirationTtl); }, delete: async (k) => { store.delete(k); }, _store: store, _ttls: ttls },
  };
};

/** In-memory Supabase REST + GitHub API. Records every request body for leak assertions. */
function fakeNetwork({ githubStatus = 200 } = {}) {
  const rows = new Map();
  const log = { bodies: [], github: [], revoked: 0 };
  const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchFn = async (u, init = {}) => {
    u = String(u);
    if (init.body) log.bodies.push(String(init.body));
    if (u === 'https://github.com/login/oauth/access_token') {
      return ok({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, scope: 'read:user', token_type: 'bearer' });
    }
    if (u.startsWith('https://sb.test/rest/v1/channel_tokens')) {
      if (init.method === 'POST') { const r = JSON.parse(init.body); rows.set(r.user_id, r); return new Response(null, { status: 201 }); }
      if (init.method === 'GET') { const id = decodeURIComponent(/user_id=eq\.([^&]+)/.exec(u)[1]); return ok(rows.has(id) ? [rows.get(id)] : []); }
      if (init.method === 'DELETE') { rows.delete(decodeURIComponent(/user_id=eq\.([^&]+)/.exec(u)[1])); return new Response(null, { status: 204 }); }
    }
    if (u.startsWith('https://api.github.com/applications/')) { log.revoked++; return new Response(null, { status: 204 }); }
    if (u.startsWith('https://api.github.com/')) {
      log.github.push(u);
      if (githubStatus !== 200) return new Response('{}', { status: githubStatus });
      if (u.endsWith('/user')) return ok({ id: 4242, login: 'octo', bio: 'Backend engineer', public_repos: 3, email: 'p@example.com', name: 'Real Name' });
      if (u.includes('/user/repos')) return ok([{ language: 'Go', topics: ['api'], fork: false }]);
      if (u.includes('/user/starred')) return ok([{ topics: ['privacy'] }]);
      if (u.includes('/events/public')) return ok(Array(7).fill({ created_at: new Date(clock.t - 86_400_000).toISOString() }));
    }
    throw new Error('unexpected request ' + u);
  };
  return { fetchFn, rows, log };
}

const clock = { t: Date.parse('2026-10-05T12:00:00Z') };
const now = () => clock.t;

async function connect(env, net) {
  const state = 'st4te';
  const stateCookie = await sign({ state, verifier: 'v'.repeat(43), exp: clock.t + 60_000 }, env.STATE_SIGNING_KEY);
  const req = new Request(`https://w.test/oauth/github/callback?code=c&state=${state}`, { headers: { Cookie: `mpt_gh_oauth=${stateCookie}` } });
  const res = await handle(req, env, { fetchFn: net.fetchFn, now });
  const session = /mpt_gh_session=([^;]+)/.exec(res.headers.getSetCookie().join('\n'))?.[1];
  return { res, session };
}

const profileReq = (session) => new Request('https://w.test/channels/github/profile', { headers: { Cookie: `mpt_gh_session=${session}`, Origin: 'https://app.test' } });

test('start redirects to GitHub with read:user only, S256 and a state cookie', async () => {
  const res = await handle(new Request('https://w.test/oauth/github/start'), baseEnv(), { now });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('scope'), 'read:user');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.match(res.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('callback rejects a state mismatch and exchanges nothing', async () => {
  const env = baseEnv();
  const cookie = await sign({ state: 'good', verifier: 'v', exp: clock.t + 1000 }, env.STATE_SIGNING_KEY);
  const req = new Request('https://w.test/oauth/github/callback?state=bad&code=c', { headers: { Cookie: `mpt_gh_oauth=${cookie}` } });
  const res = await handle(req, env, { fetchFn: async () => { throw new Error('must not be called'); }, now });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('Location'), /channel_error=invalid_state/);
});

test('callback stores ONLY ciphertext in Supabase and sets a session', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const { res, session } = await connect(env, net);
  assert.equal(res.status, 302);
  assert.ok(session, 'session cookie set');

  const row = net.rows.get('4242');
  assert.match(row.access_token_enc, /^v1\./);
  assert.match(row.refresh_token_enc, /^v1\./);
  assert.equal(row.key_version, 1);
  assert.equal(row.scope, 'read:user');
  // The acceptance criterion: no plaintext token in anything sent to the database.
  const sent = net.log.bodies.filter((b) => b.includes('user_id')).join('\n');
  assert.ok(sent.length > 0);
  assert.ok(!sent.includes(ACCESS_TOKEN) && !sent.includes(REFRESH_TOKEN), 'plaintext token reached the DB request');
  assert.ok(!JSON.stringify([...net.rows.values()]).includes('PLAINTEXT'));
});

test('profile: 401 without a session; 200 sanitized PaPIT with one', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  assert.equal((await handle(new Request('https://w.test/channels/github/profile'), env, { fetchFn: net.fetchFn, now })).status, 401);

  const { session } = await connect(env, net);
  const res = await handle(profileReq(session), env, { fetchFn: net.fetchFn, now });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.test');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  const body = await res.json();
  assert.equal(body.source_channel, 'github');
  assert.equal(body.behavioral.activity_level, 'medium'); // 7 events
  const text = JSON.stringify(body);
  for (const pii of ['octo', 'Real Name', 'p@example.com', 'Backend engineer', '4242']) assert.ok(!text.includes(pii), pii);
});

test('24h cache: HIT within TTL (no GitHub calls), MISS after TTL (mocked time)', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  clock.t = Date.parse('2026-10-05T12:00:00Z');
  const { session } = await connect(env, net);

  const first = await handle(profileReq(session), env, { fetchFn: net.fetchFn, now });
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  const callsAfterMiss = net.log.github.length;
  assert.ok(callsAfterMiss >= 4);

  clock.t += (CACHE_TTL_SECONDS - 60) * 1000; // 23h59m later
  const hit = await handle(profileReq(session), env, { fetchFn: net.fetchFn, now });
  assert.equal(hit.headers.get('X-Cache'), 'HIT');
  assert.equal(net.log.github.length, callsAfterMiss, 'cache hit must not call GitHub');
  assert.deepEqual(await hit.json(), await first.json());

  clock.t += 120 * 1000; // now past 24h
  const miss = await handle(profileReq(session), env, { fetchFn: net.fetchFn, now });
  assert.equal(miss.headers.get('X-Cache'), 'MISS');
  assert.ok(net.log.github.length > callsAfterMiss, 'expired cache refetches');
  // KV is also asked to evict entries itself after 24h:
  assert.ok(env.PROFILE_CACHE._ttls.length >= 2 && env.PROFILE_CACHE._ttls.every((t) => t === 86400));
});

test('revoked-at-GitHub token (401): row deleted and client told to reauthorize', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const { session } = await connect(env, net);
  const dead = fakeNetwork({ githubStatus: 401 });
  dead.rows = net.rows; // same DB
  const res = await handle(profileReq(session), env, {
    fetchFn: async (u, i) => (String(u).startsWith('https://sb.test') ? net.fetchFn(u, i) : dead.fetchFn(u, i)), now,
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'reauthorize');
  assert.equal(net.rows.size, 0);
});

test('DELETE revokes: row gone, cache cleared, grant revoked at GitHub, session cleared', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const { session } = await connect(env, net);
  await handle(profileReq(session), env, { fetchFn: net.fetchFn, now }); // populate cache
  assert.equal(env.PROFILE_CACHE._store.size, 1);

  const forbidden = await handle(new Request('https://w.test/channels/github', { method: 'DELETE', headers: { Cookie: `mpt_gh_session=${session}`, Origin: 'https://evil.test' } }), env, { fetchFn: net.fetchFn, now });
  assert.equal(forbidden.status, 403, 'CSRF: foreign origin rejected');
  assert.equal(net.rows.size, 1);

  const res = await handle(new Request('https://w.test/channels/github', { method: 'DELETE', headers: { Cookie: `mpt_gh_session=${session}`, Origin: 'https://app.test' } }), env, { fetchFn: net.fetchFn, now });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, revoked_at_github: true });
  assert.equal(net.rows.size, 0);
  assert.equal(env.PROFILE_CACHE._store.size, 0);
  assert.equal(net.log.revoked, 1);
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('logs never contain tokens or PII', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  try {
    const { session } = await connect(env, net);
    await handle(profileReq(session), env, { fetchFn: net.fetchFn, now });
  } finally { console.log = orig; }
  const all = lines.join('\n');
  assert.ok(lines.length > 0);
  for (const s of [ACCESS_TOKEN, REFRESH_TOKEN, 'octo', 'Real Name', 'p@example.com', 'csec']) assert.ok(!all.includes(s), s);
});

test('callback failure redirect names the failing stage and logs a sanitized reason', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  try {
    const state = 'st4te';
    const stateCookie = await sign({ state, verifier: 'v'.repeat(43), exp: clock.t + 60_000 }, env.STATE_SIGNING_KEY);
    const req = new Request(`https://w.test/oauth/github/callback?code=c&state=${state}`, { headers: { Cookie: `mpt_gh_oauth=${stateCookie}` } });
    // GitHub rejects the code exchange (e.g. wrong client secret)
    const res = await handle(req, env, { fetchFn: async () => new Response(JSON.stringify({ error: 'incorrect_client_credentials' }), { status: 200 }), now });
    const loc = new URL(res.headers.get('Location'));
    assert.equal(loc.searchParams.get('channel_error'), 'connect_failed');
    assert.equal(loc.searchParams.get('stage'), 'exchange');
  } finally { console.log = orig; }
  assert.ok(lines.join('\n').includes('incorrect_client_credentials'));
  assert.ok(!lines.join('\n').includes('csec'));
  void net;
});

test('both configured origins are accepted for CORS; others are not', async () => {
  const env = baseEnv(); const net = fakeNetwork();
  const { session } = await connect(env, net);
  for (const origin of ['https://app.test', 'https://www.app.test']) {
    const res = await handle(new Request('https://w.test/channels/github/profile', { headers: { Cookie: `mpt_gh_session=${session}`, Origin: origin } }), env, { fetchFn: net.fetchFn, now });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
  }
  const other = await handle(new Request('https://w.test/channels/github/profile', { headers: { Cookie: `mpt_gh_session=${session}`, Origin: 'https://evil.test' } }), env, { fetchFn: net.fetchFn, now });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
});

// ---- token refresh (GitHub expiring user tokens) ----
const NEW_ACCESS = 'gho_REFRESHED_ACCESS_TOKEN_abcdef';
const NEW_REFRESH = 'ghr_REFRESHED_REFRESH_TOKEN_abcdef';

/** Wraps fakeNetwork: the original access token is expired (401); the refresh endpoint is scriptable. */
function expiringNetwork(refreshResponse) {
  const net = fakeNetwork();
  const seen = { refreshBodies: [], githubAuth: [] };
  const fetchFn = async (u, init = {}) => {
    u = String(u);
    if (u === 'https://github.com/login/oauth/access_token' && String(init.body).includes('grant_type=refresh_token')) {
      seen.refreshBodies.push(String(init.body));
      return new Response(JSON.stringify(refreshResponse), { status: 200 });
    }
    if (u.startsWith('https://api.github.com/') && !u.includes('/applications/')) {
      const auth = init.headers?.Authorization;
      seen.githubAuth.push(auth);
      if (auth !== `Bearer ${NEW_ACCESS}` && seen.connected) return new Response('{}', { status: 401 });
    }
    return net.fetchFn(u, init);
  };
  return { net, seen, fetchFn };
}

test('401 with a refresh token: refreshes once, saves the NEW pair encrypted, retries and returns 200', async () => {
  const env = baseEnv();
  const { net, seen, fetchFn } = expiringNetwork({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 28800, scope: 'read:user' });
  const { session } = await connect(env, { ...net, fetchFn });
  seen.connected = true; // from now on the original access token is expired
  const before = net.rows.get('4242').access_token_enc;

  const res = await handle(profileReq(session), env, { fetchFn, now });
  assert.equal(res.status, 200);
  assert.equal(seen.refreshBodies.length, 1, 'refreshed exactly once');
  assert.ok(seen.refreshBodies[0].includes(encodeURIComponent(REFRESH_TOKEN)), 'used the stored refresh token');

  const row = net.rows.get('4242');
  assert.notEqual(row.access_token_enc, before, 'row updated');
  assert.match(row.access_token_enc, /^v1\./);
  assert.match(row.refresh_token_enc, /^v1\./);
  assert.ok(row.expires_at, 'expiry recorded');
  const sent = net.log.bodies.join('\n');
  assert.ok(!sent.includes(NEW_ACCESS) && !sent.includes(NEW_REFRESH), 'new tokens never sent to the DB in plaintext');

  // Next cache miss uses the NEW access token straight from the DB (no second refresh).
  await env.PROFILE_CACHE.delete('papit:github:4242');
  const again = await handle(profileReq(session), env, { fetchFn, now });
  assert.equal(again.status, 200);
  assert.equal(seen.refreshBodies.length, 1, 'no second refresh');
  assert.equal(seen.githubAuth.at(-1), `Bearer ${NEW_ACCESS}`);
});

test('refresh rejected (bad_refresh_token): row deleted, client told to reauthorize, refresh logged without secrets', async () => {
  const env = baseEnv();
  const { net, seen, fetchFn } = expiringNetwork({ error: 'bad_refresh_token' });
  const { session } = await connect(env, { ...net, fetchFn });
  seen.connected = true;
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  let res;
  try { res = await handle(profileReq(session), env, { fetchFn, now }); } finally { console.log = orig; }
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'reauthorize');
  assert.equal(net.rows.size, 0);
  assert.equal(seen.refreshBodies.length, 1);
  const all = lines.join('\n');
  assert.ok(all.includes('bad_refresh_token'));
  assert.ok(!all.includes(REFRESH_TOKEN) && !all.includes('csec'));
});

test('401 with no refresh token stored: reauthorize without calling the refresh endpoint', async () => {
  const env = baseEnv();
  const { net, seen, fetchFn } = expiringNetwork({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH });
  const { session } = await connect(env, { ...net, fetchFn });
  seen.connected = true;
  net.rows.get('4242').refresh_token_enc = null;
  const res = await handle(profileReq(session), env, { fetchFn, now });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'reauthorize');
  assert.equal(seen.refreshBodies.length, 0);
  assert.equal(net.rows.size, 0);
});
