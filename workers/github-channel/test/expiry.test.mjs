// MPC-10833: profile expiry (expires_at) and the POST /papit/verify refusal of stale profiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../index.js';
import { githubToPapit, profileStatus, consentExpired, verifyReceipt, canonicalJson, sha256Hex, PROFILE_VALIDITY_DAYS, CONSENT_MAX_DAYS } from '../lib/papit.js';
import { redditToPapit } from '../lib/reddit-papit.js';
import { getCached, putCached } from '../lib/cache.js';

const DAY = 86_400_000;
const T0 = new Date('2026-11-24T12:00:00Z');
const at = (days) => T0.getTime() + days * DAY;
const raw = () => ({ profile: { public_repos: 2, bio: 'Backend engineer' }, repos: [{ language: 'Go', topics: ['api'], fork: false }], starred: [{ topics: ['privacy'] }], events: [] });

/** Re-seal a profile after editing it, the way an editor would (the receipt is an unkeyed checksum). */
const reseal = async (p) => { const { cryptographic_receipt: _r, ...rest } = p; return { ...rest, cryptographic_receipt: await sha256Hex(canonicalJson(rest)) }; };
const verify = (body, nowMs, init = {}) => handle(
  new Request('https://w.test/papit/verify', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...init }), {}, { now: () => nowMs });

test('expires_at is set on both channels: generated_at + 30 days, inside the receipt', async () => {
  const gh = await githubToPapit(raw(), { now: T0 });
  assert.equal(PROFILE_VALIDITY_DAYS, 30);
  assert.equal(gh.expires_at, '2026-12-24T12:00:00.000Z');
  assert.equal(gh.privacy_boundaries.data_retention_days, PROFILE_VALIDITY_DAYS);
  assert.ok(await verifyReceipt(gh));
  assert.equal(await verifyReceipt({ ...gh, expires_at: '2027-01-01T00:00:00.000Z' }), false, 'editing expires_at breaks the receipt');
  const rd = await redditToPapit({ accountCreatedUtc: 0, comments: [], submissions: [] }, { now: T0 });
  assert.equal(rd.expires_at, '2026-12-24T12:00:00.000Z');
  assert.ok(await verifyReceipt(rd));
});

test('profileStatus: fresh up to the instant of expiry, expired from it, invalid when the dates make no sense', async () => {
  const p = await githubToPapit(raw(), { now: T0 });
  assert.equal(profileStatus(p, at(0)).status, 'fresh');
  assert.equal(profileStatus(p, at(30) - 1).status, 'fresh');
  assert.equal(profileStatus(p, at(30)).status, 'expired');
  assert.equal(profileStatus(p, at(31)).status, 'expired');
  assert.equal(profileStatus({ ...p, expires_at: 'soon' }, at(1)).status, 'invalid');
  assert.equal(profileStatus({ ...p, expires_at: new Date(at(-1)).toISOString() }, at(1)).status, 'invalid', 'expires before it was generated');
  assert.equal(profileStatus({ ...p, expires_at: new Date(at(31)).toISOString() }, at(1)).status, 'invalid', 'longer than the 30-day validity');
  assert.equal(profileStatus({ ...p, generated_at: 'x' }, at(1)).status, 'invalid');
  assert.equal(profileStatus(null, at(1)).status, 'invalid');
});

test('a profile issued before expires_at existed is valid until generated_at + 30 days', async () => {
  const { expires_at: _e, cryptographic_receipt: _r, ...old } = await githubToPapit(raw(), { now: T0 });
  assert.equal(profileStatus(old, at(29)).status, 'fresh');
  assert.equal(profileStatus(old, at(30)).status, 'expired');
});

test('verify: a fresh profile is accepted (200 valid, with its expiry)', async () => {
  const res = await verify(await githubToPapit(raw(), { now: T0 }), at(10));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { valid: true, expires_at: '2026-12-24T12:00:00.000Z' });
});

test('verify: an expired profile is refused (410 profile_expired, with the date it expired)', async () => {
  const p = await githubToPapit(raw(), { now: T0 });
  const res = await verify(p, at(31));
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { error: 'profile_expired', expires_at: '2026-12-24T12:00:00.000Z' });
  assert.equal((await verify(p, at(30))).status, 410, 'refused from the instant of expiry');
  assert.equal((await verify(p, at(30) - 1)).status, 200);
  assert.equal((await verify(await redditToPapit({ accountCreatedUtc: 0, comments: [], submissions: [] }, { now: T0 }), at(40))).status, 410, 'Reddit profiles too');
});

test('verify: a stale profile stays refused when its receipt is re-sealed, and a longer expires_at is refused as invalid', async () => {
  const p = await githubToPapit(raw(), { now: T0 });
  const longer = await reseal({ ...p, expires_at: new Date(at(365)).toISOString() });
  assert.equal(await verifyReceipt(longer), true, 'the checksum alone cannot tell');
  const res = await verify(longer, at(40));
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: 'invalid_profile' });
});

test('verify: a profile from before expires_at existed is judged by generated_at + 30 days', async () => {
  const { expires_at: _e, ...rest } = await githubToPapit(raw(), { now: T0 });
  const old = await reseal(rest);
  assert.equal((await verify(old, at(29))).status, 200);
  assert.equal((await verify(old, at(31))).status, 410);
});

test('verify: tampered, wrong-version and non-profile bodies are 422; bad JSON is 400; oversized is 413; GET is 404', async () => {
  const p = await githubToPapit(raw(), { now: T0 });
  assert.equal((await verify({ ...p, behavioral: { ...p.behavioral, activity_level: 'high' } }, at(1))).status, 422, 'receipt mismatch');
  assert.equal((await verify({ ...p, version: '2.0' }, at(1))).status, 422);
  assert.equal((await verify({ hello: 'world' }, at(1))).status, 422);
  assert.equal((await verify('not json', at(1))).status, 400);
  assert.equal((await verify('[1,2]', at(1))).status, 400);
  const big = await verify(JSON.stringify({ pad: 'x'.repeat(40_000) }), at(1));
  assert.equal(big.status, 413);
  assert.equal((await handle(new Request('https://w.test/papit/verify'), {}, { now: () => at(1) })).status, 404);
});

test('verify: stores nothing, reads no secrets and writes no profile content to the log', async () => {
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  try { await verify(await githubToPapit(raw(), { now: T0 }), at(31)); } finally { console.log = orig; }
  assert.deepEqual(lines, []);
});

test('cache: an entry whose profile has expired, or whose consent has aged out, is not served even inside the 24h window', async () => {
  const kv = new Map();
  const env = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
  const p = await githubToPapit(raw(), { now: T0 });
  await putCached(env, 's1', p, at(0));
  assert.deepEqual(await getCached(env, 's1', at(0) + 1000), p);
  // profile generated 30 days ago and cached a moment ago: the profile itself is stale
  const old = await githubToPapit(raw(), { now: new Date(at(-31)) });
  await putCached(env, 's2', old, at(0));
  assert.equal(await getCached(env, 's2', at(0) + 1000), null);
  // consent ends in an hour; the 24h cache must not outlive it
  await putCached(env, 's3', p, at(0), 'github', { consentUntil: at(0) + 3600_000 });
  assert.deepEqual(await getCached(env, 's3', at(0) + 3599_000), p);
  assert.equal(await getCached(env, 's3', at(0) + 3600_000), null);
});

test('consentExpired: 90 days, from the instant; an unreadable or missing date fails closed', () => {
  assert.equal(CONSENT_MAX_DAYS, 90);
  assert.equal(consentExpired(new Date(at(0)).toISOString(), at(89)), false);
  assert.equal(consentExpired(new Date(at(0)).toISOString(), at(90) - 1), false);
  assert.equal(consentExpired(new Date(at(0)).toISOString(), at(90)), true);
  assert.equal(consentExpired(null, at(1)), true);
  assert.equal(consentExpired('garbage', at(1)), true);
});
