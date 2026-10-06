// Reddit channel building blocks (MPC-116): rate limiter, transformer, adapter, OAuth calls, bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../lib/rate-limit.js';
import { redditToPapit, stripPii, classifyEngagement, classifyPostFrequency, extractKeywords } from '../lib/reddit-papit.js';
import { RedditAdapter, RedditAdapterError } from '../lib/reddit.js';
import {
  buildRedditAuthUrl, exchangeRedditCode, refreshRedditToken, revokeRedditToken, REDDIT_SCOPES,
} from '../lib/reddit-oauth.js';
import { bridgeReddit, redditRecords, verifySanitizationReceipt } from '../lib/bridge.js';
import { verifyReceipt } from '../lib/papit.js';

const NOW_MS = Date.parse('2026-10-06T12:00:00Z');
const NOW = new Date(NOW_MS);
const NOW_S = NOW_MS / 1000;
const DAY = 86400;
const noLimit = (fn) => fn();

// ---------------------------------------------------------------- rate limiter
test('rate limiter: 10 rapid calls start >=1s apart, in order, none dropped (fake clock)', async () => {
  let clock = 0;
  const limit = createRateLimiter({ intervalMs: 1000, now: () => clock, sleep: async (ms) => { clock += ms; } });
  const starts = [];
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => limit(async () => { starts.push(clock); return i; })));
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  starts.slice(1).forEach((s, i) => assert.ok(s - starts[i] >= 1000, `gap ${i}`));
  assert.equal(starts[9], 9000);
});

test('rate limiter: a failing call does not block the queue', async () => {
  const limit = createRateLimiter({ intervalMs: 1, sleep: async () => {} });
  const a = limit(async () => { throw new Error('boom'); });
  const b = limit(async () => 'ok');
  await assert.rejects(a, /boom/);
  assert.equal(await b, 'ok');
});

// ---------------------------------------------------------------- transformer
const activity = () => ({
  accountCreatedUtc: NOW_S - 400 * DAY,
  comments: [
    { subreddit: 'privacy', body: 'UNIQUE_RAW_BODY_MARKER encryption encryption metadata. Email me at jane@example.com or call 555-123-4567. I live in Springfield Illinois.', score: 5, controversiality: 0, createdUtc: NOW_S - 3 * DAY },
    { subreddit: 'privacy', body: 'Thanks u/someone, great encryption tooling, love it', score: 3, controversiality: 0, createdUtc: NOW_S - 4 * DAY },
    { subreddit: 'privacy', body: 'secret_handle here: awesome tracking protection', score: 2, controversiality: 0, createdUtc: NOW_S - 5 * DAY },
    { subreddit: 'typescript', body: 'generics inference helpful', score: 1, controversiality: 0, createdUtc: NOW_S - 6 * DAY },
  ],
  submissions: [{ subreddit: 'privacy', title: 'UNIQUE_RAW_TITLE_MARKER browser fingerprinting study', score: 10, createdUtc: NOW_S - 10 * DAY }],
});

test('transformer: raw text, username and PII never reach the PaPIT output', async () => {
  const out = await redditToPapit(activity(), { now: NOW, username: 'secret_handle' });
  const dump = JSON.stringify(out);
  for (const leak of ['UNIQUE_RAW_BODY_MARKER', 'UNIQUE_RAW_TITLE_MARKER', 'Email me at', 'jane', 'example.com', '555', 'Springfield', 'secret_handle', 'someone']) {
    assert.ok(!dump.toLowerCase().includes(leak.toLowerCase()), `leaked: ${leak}`);
  }
  assert.deepEqual(out.privacy_boundaries, { data_retention_days: 30, revocable: true, raw_content_stored: false });
});

test('transformer: v1 envelope, GitHub-compatible base fields, Reddit detail under behavioral.reddit', async () => {
  const out = await redditToPapit(activity(), { now: NOW, username: 'secret_handle' });
  assert.equal(out.version, '1.0');
  assert.equal(out.source_channel, 'reddit');
  assert.equal(out.generated_at, NOW.toISOString());
  assert.ok(Array.isArray(out.behavioral.interests) && out.behavioral.interests.length <= 20);
  assert.ok(out.behavioral.interests.includes('encryption'));
  out.behavioral.interests.forEach((t) => assert.match(t, /^[a-z-]+$/));
  assert.equal(out.behavioral.activity_level, 'medium'); // 4 comments + 1 post in the last 90 days = 5 items (5-50 is medium)
});

test('transformer: activity_level uses the GitHub thresholds over the last 90 days (<5 low, 5-50 medium, >50 high)', async () => {
  const mk = (n, ageDays = 1) => ({
    accountCreatedUtc: NOW_S - 400 * DAY, submissions: [],
    comments: Array.from({ length: n }, () => ({ subreddit: 'a', body: 'x', score: 1, controversiality: 0, createdUtc: NOW_S - ageDays * DAY })),
  });
  const level = async (a) => (await redditToPapit(a, { now: NOW })).behavioral.activity_level;
  assert.equal(await level(mk(4)), 'low');
  assert.equal(await level(mk(5)), 'medium');
  assert.equal(await level(mk(50)), 'medium');
  assert.equal(await level(mk(51)), 'high');
  assert.equal(await level(mk(80, 120)), 'low'); // older than 90 days does not count
});

test('transformer: community, sentiment and activity detail', async () => {
  const out = (await redditToPapit(activity(), { now: NOW, username: 'secret_handle' })).behavioral.reddit;
  const privacy = out.communities.find((c) => c.subreddit === 'r/privacy');
  assert.ok(privacy.topic_tags.includes('encryption'));
  assert.equal(out.activity.account_age_days, 400);
  assert.equal(out.activity.comment_to_post_ratio, 4);
  assert.equal(out.sentiment.overall_tone, 'positive');
});

test('transformer: receipt is the SHA-256 of the canonical payload and detects tampering', async () => {
  const out = await redditToPapit(activity(), { now: NOW });
  assert.ok(await verifyReceipt(out));
  const t = structuredClone(out); t.behavioral.interests.push('x');
  assert.ok(!(await verifyReceipt(t)));
});

test('stripPii: emails, phones, locations, zips, street addresses, mentions', () => {
  assert.doesNotMatch(stripPii('reach me: a.b+c@mail.example.co.uk ok'), /@|mail\.example/);
  for (const p of ['555-123-4567', '(555) 123-4567', '+1 555 123 4567', '555.123.4567']) assert.doesNotMatch(stripPii(`call ${p} now`), /\d{3}/);
  assert.ok(!stripPii('I live in Portland Oregon and love it').includes('Portland'));
  assert.ok(!stripPii('based in Berlin, Germany').includes('Berlin'));
  assert.ok(!stripPii('zip 94107 here').includes('94107'));
  assert.ok(!stripPii('at 221 Baker Street today').includes('Baker'));
  assert.doesNotMatch(stripPii('hi u/foo-bar and /u/baz'), /foo|baz/);
});

test('classification: engagement levels, post frequency, keyword limits', () => {
  assert.deepEqual([0, 2, 3, 9, 10, 29, 30, 200].map(classifyEngagement),
    ['lurker', 'lurker', 'occasional', 'occasional', 'active', 'active', 'power_user', 'power_user']);
  const ts = (n, span) => Array.from({ length: n }, (_, i) => NOW_S - (i * span * DAY) / n);
  assert.equal(classifyPostFrequency([], NOW_S), 'rare');
  assert.equal(classifyPostFrequency(ts(1, 200), NOW_S), 'rare');
  assert.equal(classifyPostFrequency(ts(10, 70), NOW_S), 'weekly');
  assert.equal(classifyPostFrequency(ts(50, 50), NOW_S), 'daily');
  assert.equal(classifyPostFrequency(ts(200, 40), NOW_S), 'hyperactive');
  assert.ok(extractKeywords('alpha beta gamma delta epsilon zeta eta theta '.repeat(3)).length <= 5);
});

// ---------------------------------------------------------------- adapter
const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
const me = { id: 'abc123', name: 'tester', created_utc: NOW_S - 100 * DAY, total_karma: 50, verified: true };

test('adapter: calls the Reddit API with bearer auth and a User-Agent, unwraps listings, normalizes fields', async () => {
  const calls = [];
  const fetchFn = async (u, init) => {
    u = String(u); calls.push({ u, h: init.headers });
    if (u.endsWith('/api/v1/me')) return ok(me);
    if (u.includes('/comments')) return ok({ data: { children: [{ data: { subreddit: { display_name: 'privacy' }, body: 'RAW_COMMENT', score: 4, controversiality: 0, created_utc: 1 } }] } });
    if (u.includes('/submitted')) return ok({ data: { children: [{ data: { subreddit: 'privacy', title: 'RAW_TITLE', score: 2, created_utc: 2 } }] } });
    throw new Error('unexpected ' + u);
  };
  const a = await new RedditAdapter({ token: 'tok', userAgent: 'UA/1.0', fetchFn, limiter: noLimit }).fetchActivity();
  assert.equal(a.username, 'tester');
  assert.equal(a.id, 'abc123');
  assert.equal(a.comments[0].subreddit, 'privacy');
  assert.equal(a.submissions.length, 1);
  assert.ok(calls.every((c) => c.h.Authorization === 'Bearer tok' && c.h['User-Agent'] === 'UA/1.0'));
  assert.ok(calls.some((c) => c.u === 'https://oauth.reddit.com/user/tester/comments?limit=100&raw_json=1'));
  assert.ok(calls.some((c) => c.u === 'https://oauth.reddit.com/user/tester/submitted?limit=50&raw_json=1'));
});

test('adapter: errors carry the status only (no token, URL or body); fetch is called unbound', async () => {
  await assert.rejects(
    new RedditAdapter({ token: 'SECRET-TOK', fetchFn: async () => new Response('secret body', { status: 429 }), limiter: noLimit }).fetchActivity(),
    (e) => { assert.ok(e instanceof RedditAdapterError); assert.equal(e.status, 429); assert.ok(!/SECRET-TOK|secret body|http/.test(e.message)); return true; },
  );
  const strictFetch = function (u) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    return Promise.resolve(String(u).endsWith('/me') ? ok(me) : ok({ data: { children: [] } }));
  };
  assert.equal((await new RedditAdapter({ token: 't', fetchFn: strictFetch, limiter: noLimit }).fetchActivity()).username, 'tester');
});

// ---------------------------------------------------------------- OAuth calls
test('auth URL: minimum scopes, permanent duration (refresh token), state, no PKCE', () => {
  const u = new URL(buildRedditAuthUrl({ clientId: 'cid', redirectUri: 'https://w.test/oauth/reddit/callback', state: 's' }));
  assert.equal(u.origin + u.pathname, 'https://www.reddit.com/api/v1/authorize');
  assert.equal(u.searchParams.get('scope'), 'identity read history');
  assert.deepEqual(REDDIT_SCOPES, ['identity', 'read', 'history']);
  assert.equal(u.searchParams.get('duration'), 'permanent');
  assert.equal(u.searchParams.get('state'), 's');
  assert.equal(u.searchParams.get('code_challenge'), null);
});

test('token exchange and refresh use Basic client credentials and a User-Agent; errors never echo the body', async () => {
  const seen = [];
  const fetchFn = async (u, init) => { seen.push({ u: String(u), h: init.headers, b: String(init.body) }); return ok({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }); };
  const creds = { clientId: 'cid', clientSecret: 'sec', userAgent: 'UA/1' };
  await exchangeRedditCode({ code: 'c', redirectUri: 'https://w.test/cb', ...creds }, fetchFn);
  await refreshRedditToken({ refreshToken: 'R', ...creds }, fetchFn);
  assert.equal(seen[0].h.Authorization, `Basic ${btoa('cid:sec')}`);
  assert.equal(seen[0].h['User-Agent'], 'UA/1');
  assert.match(seen[0].b, /grant_type=authorization_code/);
  assert.match(seen[1].b, /grant_type=refresh_token/);
  await assert.rejects(exchangeRedditCode({ code: 'c', redirectUri: 'x', ...creds }, async () => ok({ error: 'invalid_grant', secret: 'LEAK' })),
    (e) => { assert.match(e.message, /invalid_grant/); assert.ok(!e.message.includes('LEAK')); return true; });
});

test('revoke posts the token with a type hint and reports success on 204', async () => {
  let body;
  const r = await revokeRedditToken({ token: 'R', hint: 'refresh_token', clientId: 'c', clientSecret: 's' },
    async (u, init) => { body = String(init.body); return new Response(null, { status: 204 }); });
  assert.equal(r, true);
  assert.match(body, /token=R/); assert.match(body, /token_type_hint=refresh_token/);
});

// ---------------------------------------------------------------- bridge (classify -> sanitize -> PaPIT)
test('bridgeReddit: handle and id are restricted and dropped; text is sanitized before the transformer; receipts verify', async () => {
  const raw = { ...activity(), id: 'abc123', username: 'secret_handle', totalKarma: 9, verified: true };
  raw.comments[0].body += ' Find me at https://example.org/me or @someone_else, SSN 123-45-6789.';
  const { papit, sanitization, classification, sanitization_receipt: receipt } = await bridgeReddit(raw, { now: NOW });
  assert.equal(classification.restricted, 2); // username + user_id
  assert.equal(sanitization.records_dropped, 2);
  assert.ok(sanitization.redactions.url >= 1 && sanitization.redactions.email >= 1 && sanitization.redactions.ssn >= 1);
  assert.ok(await verifySanitizationReceipt({ papit, sanitization, sanitization_receipt: receipt }));
  assert.ok(await verifyReceipt(papit));
  const dump = JSON.stringify(papit);
  for (const leak of ['secret_handle', 'abc123', 'example.org', '123-45-6789', 'someone_else', 'UNIQUE_RAW']) assert.ok(!dump.includes(leak), leak);
  assert.equal(redditRecords(raw).filter((r) => r.type === 'comment').length, 4);
});
