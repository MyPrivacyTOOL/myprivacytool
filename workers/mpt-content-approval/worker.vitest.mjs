// @vitest-environment node
// MPC-8374: schema validation + Make.com hand-off for mpt-content-approval. Make.com and Slack are mocked; D1 is an in-memory fake.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { process as processApproval, buildMakePayload, maskUrl, postToMake, scheduledTime, toHktIso, verifySlack } from './worker.js';
import { validateMakePayload, isHktIso, isHttpsUrl, PLATFORMS } from './schema.js';

const TASK = 'daily-posts-2026-10-21';
const MAKE_URL = 'https://hook.eu1.make.com/mock-token-abcd';
const ASSET = 'https://cdn.myprivacytool.io/assets/post.png';
const APPROVED_AT = '2026-10-20T23:00:00.000Z'; // 2026-10-21 07:00 HKT, before every publish window

const COPY = { x: 'Short insight.\n---\nSecond post.', linkedin: 'LinkedIn copy', instagram: 'IG copy', facebook: 'FB copy', pinterest: 'Pin copy', youtube: 'YT copy', reddit: 'Reddit copy' };
const draftFor = (platform, extra = {}) => ({ platform, copy: COPY[platform], topic: 'Data brokers', cta: 'Check your exposure', ...(platform === 'reddit' ? { title: 'A title' } : {}), ...extra });
const sixDrafts = (extra) => PLATFORMS.map((p) => draftFor(p, extra));

/** Minimal D1 fake covering the statements the worker issues. */
function fakeD1({ failMakeLog = false } = {}) {
  const tables = { agent_execution_logs: [], social_metrics: [], make_webhook_log: [] };
  const prepare = (sql) => ({
    bind: (...args) => ({
      run: async () => {
        if (sql.startsWith('DELETE FROM agent_execution_logs')) { tables.agent_execution_logs = tables.agent_execution_logs.filter((r) => r[0] !== args[0]); return {}; }
        const table = /INSERT INTO (\w+)/.exec(sql)[1];
        if (table === 'make_webhook_log' && failMakeLog) throw new Error('D1 down');
        if (table === 'agent_execution_logs' && tables.agent_execution_logs.some((r) => r[0] === args[0])) throw new Error('UNIQUE constraint failed: agent_execution_logs.id');
        tables[table].push(args);
        return {};
      },
      all: async () => {
        const [task, status] = args;
        return { results: tables.agent_execution_logs.filter((r) => r[2] === task && r[3] === status).map((r) => ({ draft_content: r[5] })) };
      },
    }),
  });
  return { prepare, tables };
}
const statuses = (db) => db.tables.agent_execution_logs.map((r) => r[3]);
const seed = (db, drafts, status = 'drafted') => drafts.forEach((d) => db.tables.agent_execution_logs.push(['id', 't', TASK, status, null, JSON.stringify(d)]));
const mkEnv = (db, extra = {}) => ({ AGENT_LOGS: db, MAKE_WEBHOOK_URL: MAKE_URL, DEFAULT_ASSET_URL: ASSET, SLACK_BOT_TOKEN: 'xoxb-test', SLACK_APPROVER: 'chris', ...extra });
const target = { channel: 'C1', ts: '111.222' };

let fetchMock;
const slackTexts = () => fetchMock.mock.calls.filter(([u]) => u === 'https://slack.com/api/chat.postMessage').map(([, init]) => JSON.parse(init.body).text);
const makeCalls = () => fetchMock.mock.calls.filter(([u]) => u === MAKE_URL);
const mockMake = (impl) => {
  fetchMock = vi.fn(async (url, init) => (url === MAKE_URL ? impl(url, init) : new Response('{"ok":true}')));
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => { mockMake(async () => new Response('Accepted', { status: 200 })); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// A fully valid envelope to mutate in the validation tests.
const valid = () => buildMakePayload(sixDrafts(), { taskId: TASK, approvedBy: 'chris', approvalTimestamp: APPROVED_AT, defaultAssetUrl: ASSET });
const errorsOf = (mutate) => { const p = valid(); mutate(p); return validateMakePayload(p).errors; };

describe('schema primitives', () => {
  it('isHktIso accepts only real ISO 8601 date-times with +08:00', () => {
    expect(isHktIso('2026-10-21T08:30:00+08:00')).toBe(true);
    expect(isHktIso('2026-10-21T08:30:00.123+08:00')).toBe(true);
    for (const bad of ['2026-10-21T08:30:00Z', '2026-10-21T08:30:00+09:00', '2026-10-21 08:30:00+08:00', '2026-10-21', '2026-02-30T08:30:00+08:00', '2026-10-21T24:00:00+08:00', 'tomorrow', '', null, 5]) {
      expect(isHktIso(bad)).toBe(false);
    }
  });
  it('isHttpsUrl accepts only well-formed https URLs', () => {
    expect(isHttpsUrl('https://myprivacytool.io/a?b=1')).toBe(true);
    for (const bad of ['http://myprivacytool.io', 'ftp://x.io', 'javascript:alert(1)', 'https://localhost', 'https://u:p@x.io', 'https://has space.io', 'not a url', '', null, 7]) {
      expect(isHttpsUrl(bad)).toBe(false);
    }
  });
});

describe('validateMakePayload', () => {
  it('accepts the six-platform envelope (and the legacy reddit post)', () => {
    expect(validateMakePayload(valid())).toEqual({ ok: true, errors: [] });
    const withReddit = buildMakePayload([...sixDrafts(), draftFor('reddit', { slides: ['a'] })], { taskId: TASK, approvedBy: 'chris', approvalTimestamp: APPROVED_AT, defaultAssetUrl: ASSET });
    expect(validateMakePayload(withReddit).ok).toBe(true);
  });
  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'x', 3, []]) expect(validateMakePayload(bad)).toEqual({ ok: false, errors: ['payload: must be an object'] });
  });
  it('rejects a bad envelope', () => {
    expect(errorsOf((p) => { p.extra = 1; })).toContain('extra: unknown field');
    expect(errorsOf((p) => { p.schema_version = '2'; })).toContain('schema_version: must be "1.0"');
    expect(errorsOf((p) => { p.campaign = ' '; })).toContain('campaign: required');
    expect(errorsOf((p) => { p.drafted_content_id = 'nope'; })[0]).toMatch(/drafted_content_id/);
    expect(errorsOf((p) => { delete p.drafted_content_id; })[0]).toMatch(/drafted_content_id/);
    expect(errorsOf((p) => { delete p.approved_by; })).toContain('approved_by: required');
    expect(errorsOf((p) => { p.approval_timestamp = '2026-10-21T07:00:00Z'; })[0]).toMatch(/approval_timestamp/);
    expect(errorsOf((p) => { p.posts = []; })).toContain('posts: must be a non-empty array');
    expect(errorsOf((p) => { delete p.posts; })).toContain('posts: must be a non-empty array');
  });
  it('rejects missing post fields', () => {
    for (const field of ['platform', 'title', 'body', 'hashtags', 'cta', 'content_type', 'asset_url', 'link_url', 'publish_timestamp']) {
      expect(errorsOf((p) => { delete p.posts[1][field]; })).toContain(`posts[1].${field}: required`);
      expect(errorsOf((p) => { p.posts[1][field] = null; })).toContain(`posts[1].${field}: required`);
    }
  });
  it('rejects invalid URLs', () => {
    expect(errorsOf((p) => { p.posts[0].asset_url = 'http://insecure.io/a.png'; })).toContain('posts[0].asset_url: must be a valid https:// URL');
    expect(errorsOf((p) => { p.posts[0].asset_url = 'not a url'; })).toContain('posts[0].asset_url: must be a valid https:// URL');
    expect(errorsOf((p) => { p.posts[2].link_url = 'ftp://x.io'; })).toContain('posts[2].link_url: must be a valid https:// URL');
  });
  it('rejects non-ISO-8601 or non-HKT publish timestamps', () => {
    for (const bad of ['2026-10-21 08:30', '2026-10-21T08:30:00Z', '2026-10-21T00:30:00+00:00', '21/10/2026']) {
      expect(errorsOf((p) => { p.posts[3].publish_timestamp = bad; })).toContain('posts[3].publish_timestamp: must be ISO 8601 with +08:00 (HKT) offset');
    }
  });
  it('rejects bad platforms, types and duplicate platforms', () => {
    expect(errorsOf((p) => { p.posts[0].platform = 'tiktok'; })[0]).toMatch(/posts\[0\]\.platform: must be one of/);
    expect(errorsOf((p) => { p.posts[0].content_type = 'gif'; })[0]).toMatch(/content_type/);
    expect(errorsOf((p) => { p.posts[1].platform = 'x'; })).toContain('posts: duplicate platform x');
    expect(errorsOf((p) => { p.posts[0].hashtags = 5; })).toContain('posts[0].hashtags: must be a string');
    expect(errorsOf((p) => { p.posts[0].title = ''; })).toContain('posts[0].title: must be a non-empty string');
    expect(errorsOf((p) => { p.posts[0].bonus = true; })).toContain('posts[0].bonus: unknown field');
    expect(errorsOf((p) => { p.posts[0] = 'x'; })).toContain('posts[0]: must be an object');
  });
  it('enforces per-platform length limits (X per post of the thread)', () => {
    expect(errorsOf((p) => { p.posts[0].body = `${'a'.repeat(281)}`; })).toContain('posts[0].body: exceeds 280 characters in a post');
    expect(errorsOf((p) => { p.posts[0].body = `${'a'.repeat(280)}\n---\n${'b'.repeat(280)}`; })).toEqual([]);
    expect(errorsOf((p) => { p.posts[4].body = 'a'.repeat(501); })).toContain('posts[4].body: exceeds 500 characters');
  });
  it('validates reddit-only and slides fields', () => {
    const base = () => buildMakePayload([draftFor('reddit')], { taskId: TASK, approvedBy: 'chris', approvalTimestamp: APPROVED_AT, defaultAssetUrl: ASSET });
    const p = base(); p.posts[0].subreddit = 'not valid!!';
    expect(validateMakePayload(p).errors).toContain('posts[0].subreddit: invalid');
    const q = base(); q.posts[0].slides = [];
    expect(validateMakePayload(q).errors).toContain('posts[0].slides: must be a non-empty array of strings');
    expect(validateMakePayload(base()).ok).toBe(true);
  });
});

describe('payload helpers', () => {
  it('toHktIso / scheduledTime format +08:00 and never schedule in the past', () => {
    expect(toHktIso(new Date('2026-10-20T23:00:00Z'))).toBe('2026-10-21T07:00:00+08:00');
    expect(scheduledTime('2026-10-21', 'linkedin', new Date('2026-10-20T23:00:00Z'))).toBe('2026-10-21T08:30:00+08:00');
    expect(scheduledTime('2026-10-21', 'linkedin', new Date('2026-10-21T04:00:00Z'))).toBe('2026-10-21T12:00:00+08:00');
  });
  it('buildMakePayload orders platforms, infers content type and falls back for title/asset', () => {
    const drafts = [draftFor('youtube', { asset_url: 'https://cdn.myprivacytool.io/v.mp4' }), draftFor('x'), draftFor('reddit', { title: 'T', subreddit: 'r/cybersecurity' }), { platform: 'facebook', copy: 'c', hashtags: '#a' }];
    const p = buildMakePayload(drafts, { taskId: TASK, approvedBy: 'chris', approvalTimestamp: APPROVED_AT });
    expect(p.posts.map((x) => x.platform)).toEqual(['x', 'facebook', 'youtube', 'reddit']);
    expect(p.posts[0].asset_url).toBeNull(); // no asset and no default
    expect(p.posts[1]).toMatchObject({ title: 'MyPrivacyTOOL', cta: 'Check your exposure', hashtags: '#a', content_type: 'image' });
    expect(p.posts[2].content_type).toBe('video');
    expect(p.posts[3].subreddit).toBe('r/cybersecurity');
    expect(p.approval_timestamp).toBe('2026-10-21T07:00:00+08:00');
  });
  it('image_key: set on LinkedIn only (draft value wins over the default), validated, absent when unset', () => {
    const args = { taskId: TASK, approvedBy: 'chris', approvalTimestamp: APPROVED_AT, defaultAssetUrl: ASSET };
    const withDefault = buildMakePayload(sixDrafts(), { ...args, defaultImageKey: 'social/end-card.png' });
    expect(withDefault.posts.filter((x) => x.image_key).map((x) => [x.platform, x.image_key])).toEqual([['linkedin', 'social/end-card.png']]);
    expect(validateMakePayload(withDefault).ok).toBe(true);
    const own = buildMakePayload([draftFor('linkedin', { image_key: 'social/own.png' })], { ...args, defaultImageKey: 'social/end-card.png' });
    expect(own.posts[0].image_key).toBe('social/own.png');
    expect(buildMakePayload(sixDrafts(), args).posts.some((x) => 'image_key' in x)).toBe(false);
    for (const bad of ['/abs.png', '../x.png', 'a b.png', 'https://x.io/a.png']) {
      const p = buildMakePayload(sixDrafts(), args);
      p.posts[1].image_key = bad;
      expect(validateMakePayload(p).errors.join()).toMatch(/image_key/);
    }
  });
  it('maskUrl hides the token path', () => {
    expect(maskUrl(MAKE_URL)).toBe('https://hook.eu1.make.com/…abcd');
    expect(maskUrl('garbage')).toBe('invalid-url');
  });
});

describe('postToMake', () => {
  it('sends JSON with the optional x-make-apikey header', async () => {
    const db = fakeD1();
    const out = await postToMake(mkEnv(db, { MAKE_API_KEY: 'k1' }), TASK, valid());
    expect(out).toEqual({ ok: true, statusCode: 200, error: null });
    const [url, init] = makeCalls()[0];
    expect(url).toBe(MAKE_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-make-apikey': 'k1' });
    expect(JSON.parse(init.body).posts).toHaveLength(6);
    const [row] = db.tables.make_webhook_log;
    expect(row.slice(2, 4)).toEqual([TASK, 'https://hook.eu1.make.com/…abcd']);
    expect(row[4]).toBe(200);
    expect(row[6]).toBe('Accepted');
    expect(row[7]).toBeNull();
  });
  it('omits the api-key header when not configured and truncates logged bodies', async () => {
    mockMake(async () => new Response('x'.repeat(900), { status: 200 }));
    const db = fakeD1();
    await postToMake(mkEnv(db), TASK, valid());
    expect(makeCalls()[0][1].headers['x-make-apikey']).toBeUndefined();
    const [row] = db.tables.make_webhook_log;
    expect(row[6].length).toBeLessThan(560);
    expect(row[6]).toContain('[truncated 400]');
    expect(row[5]).toContain('[truncated');
    expect(row[5].length).toBeLessThan(2100);
  });
  it('records a 5xx as a failure with the status code', async () => {
    mockMake(async () => new Response('upstream boom', { status: 503 }));
    const db = fakeD1();
    expect(await postToMake(mkEnv(db), TASK, valid())).toEqual({ ok: false, statusCode: 503, error: 'Make webhook 503' });
    expect(db.tables.make_webhook_log[0].slice(4)).toEqual([503, expect.any(String), 'upstream boom', 'Make webhook 503']);
  });
  it('records network errors and unreadable bodies', async () => {
    mockMake(async () => { throw new Error('timeout'); });
    const db = fakeD1();
    const out = await postToMake(mkEnv(db), TASK, valid());
    expect(out).toEqual({ ok: false, statusCode: null, error: 'Make webhook request failed: timeout' });
    expect(db.tables.make_webhook_log[0][4]).toBeNull();

    mockMake(async () => ({ ok: true, status: 200, text: async () => { throw new Error('stream'); } }));
    const db2 = fakeD1();
    expect((await postToMake(mkEnv(db2), TASK, valid())).ok).toBe(true);
    expect(db2.tables.make_webhook_log[0][6]).toBe('');

    mockMake(async () => { throw 'string-error'; });
    expect((await postToMake(mkEnv(fakeD1()), TASK, valid())).error).toBe('Make webhook request failed: string-error');
  });
  it('fails without calling Make when the URL secret is missing, and survives a logging failure', async () => {
    const db = fakeD1();
    const out = await postToMake(mkEnv(db, { MAKE_WEBHOOK_URL: undefined }), TASK, valid());
    expect(out.error).toBe('MAKE_WEBHOOK_URL is not configured');
    expect(makeCalls()).toHaveLength(0);
    expect(db.tables.make_webhook_log).toHaveLength(1);

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out2 = await postToMake(mkEnv(fakeD1({ failMakeLog: true })), TASK, valid());
    expect(out2.ok).toBe(true);
    expect(err).toHaveBeenCalledWith('make_webhook_log insert failed', 'D1 down');
  });
});

describe('process (approval flow)', () => {
  it('approve_all success: validates, POSTs one payload, logs, replies COMPLETED', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    const out = await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target });
    expect(out).toEqual({ status: 200, message: 'approved' });
    expect(makeCalls()).toHaveLength(1);
    const sent = JSON.parse(makeCalls()[0][1].body);
    expect(validateMakePayload(sent).ok).toBe(true);
    expect(sent.posts.map((p) => p.platform)).toEqual(PLATFORMS);
    expect(statuses(db)).toEqual(expect.arrayContaining(['approved', 'published']));
    expect(statuses(db)).not.toContain('failed');
    expect(db.tables.social_metrics).toHaveLength(6);
    expect(db.tables.make_webhook_log).toHaveLength(1);
    expect(slackTexts()).toEqual(['✅ *COMPLETED*: approved by chris at 07:00 HKT. Make.com accepted the hand-off (HTTP 200) for 6 posts: X, LinkedIn, IG, FB, Pinterest, YouTube. Publishing is done by the Make.com scenario.']);
  });
  it('does not claim the posts are live: the completion text says handed off / accepted', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target });
    expect(slackTexts()[0]).not.toMatch(/Posted to/);
    expect(slackTexts()[0]).toMatch(/accepted the hand-off/);
  });
  it('replaces the buttons on the original message with the COMPLETED banner', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    const blocks = [{ type: 'header' }, { type: 'section' }, { type: 'actions', elements: [] }];
    await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target: { ...target, blocks } });
    const [, init] = fetchMock.mock.calls.find(([u]) => u === 'https://slack.com/api/chat.update');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ channel: 'C1', ts: '111.222' });
    expect(body.blocks.map((b) => b.type)).toEqual(['header', 'section', 'section']);
    expect(body.blocks.at(-1).text.text).toMatch(/^✅ \*COMPLETED\*/);
  });
  it('skips the message update when there are no original blocks or no token', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target });
    expect(fetchMock.mock.calls.some(([u]) => u === 'https://slack.com/api/chat.update')).toBe(false);
  });
  it('a second click while the first is in flight does not hand off twice', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    const env = mkEnv(db);
    const job = { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target };
    const [a, b] = await Promise.all([processApproval(env, job), processApproval(env, job)]);
    expect([a.message, b.message].sort()).toEqual(['approved', 'in progress']);
    expect(makeCalls()).toHaveLength(1);
    expect(slackTexts().some((t) => t === 'Already being processed; ignoring.')).toBe(true);
  });
  it('a failed hand-off releases the claim so the cycle can be approved again', async () => {
    let ok = false;
    mockMake(async () => new Response(ok ? 'Accepted' : 'nope', { status: ok ? 200 : 500 }));
    const db = fakeD1(); seed(db, sixDrafts());
    const env = mkEnv(db);
    const job = { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target };
    expect((await processApproval(env, job)).status).toBe(502);
    ok = true;
    expect(await processApproval(env, job)).toEqual({ status: 200, message: 'approved' });
  });
  it('defaults the approval time to now when the timestamp is missing or invalid', async () => {
    for (const timestamp of [undefined, 'garbage']) {
      const db = fakeD1(); seed(db, sixDrafts());
      const out = await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp, approver: 'chris' });
      expect(out.status).toBe(200);
    }
  });
  it('approve_all 5xx: logs the failure, replies "Failed to post drafts. Logged for retry.", stays re-approvable', async () => {
    mockMake(async () => new Response('bad gateway', { status: 502 }));
    const db = fakeD1(); seed(db, sixDrafts());
    const out = await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target });
    expect(out).toEqual({ status: 502, message: 'Make webhook 502' });
    expect(statuses(db)).toContain('failed');
    expect(statuses(db)).not.toContain('published');
    expect(db.tables.social_metrics).toHaveLength(0);
    expect(db.tables.make_webhook_log[0][4]).toBe(502);
    expect(slackTexts()).toEqual(['Failed to post drafts. Logged for retry.']);

    mockMake(async () => new Response('ok', { status: 200 })); // retry succeeds
    const retry = await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target });
    expect(retry.status).toBe(200);
  });
  it('approve_all with an invalid payload: nothing is sent to Make.com', async () => {
    const db = fakeD1(); seed(db, [draftFor('x'), draftFor('linkedin')]);
    const env = mkEnv(db, { DEFAULT_ASSET_URL: '' }); // no asset -> asset_url required
    const out = await processApproval(env, { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris', target });
    expect(out.status).toBe(422);
    expect(out.message).toContain('posts[0].asset_url: required');
    expect(makeCalls()).toHaveLength(0);
    expect(db.tables.make_webhook_log).toHaveLength(0);
    expect(statuses(db)).toContain('failed');
    expect(slackTexts()[0]).toMatch(/^Failed to post drafts\. Schema validation failed, nothing was sent to Make\.com: /);
  });
  it('reject logs to D1 and does not call Make', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    const out = await processApproval(mkEnv(db), { action: 'reject', taskId: TASK, approver: 'chris', target });
    expect(out).toEqual({ status: 200, message: 'rejected' });
    expect(statuses(db)).toContain('rejected');
    expect(makeCalls()).toHaveLength(0);
    expect(slackTexts()).toEqual(['Rejected. Awaiting next cycle.']);
  });
  it('reject also replaces the buttons with a REJECTED banner', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    await processApproval(mkEnv(db), { action: 'reject', taskId: TASK, approver: 'chris', target: { ...target, blocks: [{ type: 'actions' }] } });
    const [, init] = fetchMock.mock.calls.find(([u]) => u === 'https://slack.com/api/chat.update');
    expect(JSON.parse(init.body).blocks[0].text.text).toMatch(/^❌ \*REJECTED\* by chris/);
  });
  it('edit_resubmit is acknowledged but not automated', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    const out = await processApproval(mkEnv(db), { action: 'edit_resubmit', taskId: TASK, approver: 'chris', target });
    expect(out).toEqual({ status: 200, message: 'edit requested' });
    expect(statuses(db)).toContain('edit_requested');
  });
  it('unknown actions are 400, missing drafts are 404', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    expect((await processApproval(mkEnv(db), { action: 'launch', taskId: TASK, approver: 'chris' })).status).toBe(400);
    const out = await processApproval(mkEnv(fakeD1()), { action: 'approve_all', taskId: TASK, approver: 'chris' });
    expect(out).toEqual({ status: 404, message: `no drafts for ${TASK}` });
  });
  it('a published or rejected cycle is final; the Slack target comes from the notified row', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    seed(db, [target], 'notified');
    await processApproval(mkEnv(db), { action: 'reject', taskId: TASK, approver: 'chris' });
    const out = await processApproval(mkEnv(db), { action: 'approve_all', taskId: TASK, timestamp: APPROVED_AT, approver: 'chris' });
    expect(out).toEqual({ status: 200, message: 'already decided' });
    expect(makeCalls()).toHaveLength(0);
    expect(slackTexts()).toEqual(['Rejected. Awaiting next cycle.', 'Already decided for this cycle; ignoring.']);
  });
  it('skips Slack replies without a token and swallows Slack errors', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    await processApproval(mkEnv(db, { SLACK_BOT_TOKEN: undefined }), { action: 'reject', taskId: TASK, approver: 'chris', target });
    expect(slackTexts()).toHaveLength(0);

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock = vi.fn(async () => { throw new Error('slack down'); });
    vi.stubGlobal('fetch', fetchMock);
    const db2 = fakeD1(); seed(db2, sixDrafts());
    await expect(processApproval(mkEnv(db2), { action: 'reject', taskId: TASK, approver: 'chris', target })).resolves.toMatchObject({ status: 200 });
    expect(err).toHaveBeenCalledWith('slack reply failed', 'slack down');
  });
});

describe('verifySlack', () => {
  const secret = 'shh';
  const sign = async (ts, body) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
    return `v0=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  };
  const req = (headers) => new Request('https://x.test/approve', { method: 'POST', headers });
  const now = 1_800_000_000_000;
  it('accepts a good signature and rejects bad, stale or unsigned requests', async () => {
    const ts = String(now / 1000);
    const good = await sign(ts, 'body');
    expect(await verifySlack({ SLACK_SIGNING_SECRET: secret }, req({ 'x-slack-request-timestamp': ts, 'x-slack-signature': good }), 'body', now)).toBe(true);
    expect(await verifySlack({ SLACK_SIGNING_SECRET: secret }, req({ 'x-slack-request-timestamp': ts, 'x-slack-signature': good }), 'tampered', now)).toBe(false);
    expect(await verifySlack({ SLACK_SIGNING_SECRET: secret }, req({ 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=short' }), 'body', now)).toBe(false);
    expect(await verifySlack({ SLACK_SIGNING_SECRET: secret }, req({ 'x-slack-request-timestamp': String(now / 1000 - 1000), 'x-slack-signature': good }), 'body', now)).toBe(false);
    expect(await verifySlack({ SLACK_SIGNING_SECRET: secret }, req({}), 'body', now)).toBe(false);
    expect(await verifySlack({}, req({ 'x-slack-request-timestamp': ts, 'x-slack-signature': good }), 'body', now)).toBe(false);
  });
});

describe('fetch handler (POST /approve)', () => {
  const ctx = () => { const pending = []; return { waitUntil: (p) => pending.push(p), pending }; };
  const jsonReq = (body, token = 'tok', method = 'POST') => new Request('https://x.test/approve', { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : body });
  const envFor = (db) => mkEnv(db, { APPROVAL_API_TOKEN: 'tok' });
  const payload = (over = {}) => JSON.stringify({ action: 'approve_all', drafted_content_id: TASK, timestamp: APPROVED_AT, ...over });

  it('serves a health response elsewhere and 405 for non-POST', async () => {
    const db = fakeD1();
    const health = await worker.fetch(new Request('https://x.test/'), envFor(db), ctx());
    expect(await health.json()).toEqual({ ok: true, worker: 'mpt-content-approval' });
    const res = await worker.fetch(jsonReq('', 'tok', 'GET'), envFor(db), ctx());
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
  it('JSON: approve_all end to end with the bearer token', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    const res = await worker.fetch(jsonReq(payload()), envFor(db), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: 'approved' });
    expect(makeCalls()).toHaveLength(1);
  });
  it('JSON: Make 5xx surfaces as 502', async () => {
    mockMake(async () => new Response('x', { status: 500 }));
    const db = fakeD1(); seed(db, sixDrafts());
    const res = await worker.fetch(jsonReq(payload()), envFor(db), ctx());
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });
  it('JSON: rejects bad auth, bad JSON and bad ids', async () => {
    const db = fakeD1(); seed(db, sixDrafts());
    expect((await worker.fetch(jsonReq(payload(), 'wrong'), envFor(db), ctx())).status).toBe(401);
    expect((await worker.fetch(jsonReq(payload()), { ...envFor(db), APPROVAL_API_TOKEN: undefined }, ctx())).status).toBe(401);
    expect((await worker.fetch(jsonReq('{nope'), envFor(db), ctx())).status).toBe(400);
    expect((await worker.fetch(jsonReq(payload({ drafted_content_id: 'x' })), envFor(db), ctx())).status).toBe(400);
    expect((await worker.fetch(jsonReq(JSON.stringify({ action: 'approve_all' })), envFor(db), ctx())).status).toBe(400);
    expect(makeCalls()).toHaveLength(0);
  });

  describe('Slack interactivity', () => {
    const secret = 'sign-secret';
    const slackReq = async (payloadObj, { ts = String(Math.floor(Date.now() / 1000)), bad = false } = {}) => {
      const raw = new URLSearchParams({ payload: JSON.stringify(payloadObj) }).toString();
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${raw}`));
      const hexSig = `v0=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      return new Request('https://x.test/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': ts, 'x-slack-signature': bad ? 'v0=00' : hexSig },
        body: raw,
      });
    };
    const click = { actions: [{ action_id: 'approve_all', value: TASK }], user: { username: 'ck' }, channel: { id: 'C1' }, message: { ts: '1.2' } };

    it('acks immediately, then hands off to Make in the background and replies in the thread', async () => {
      const db = fakeD1(); seed(db, sixDrafts());
      const c = ctx();
      const res = await worker.fetch(await slackReq(click), mkEnv(db, { SLACK_SIGNING_SECRET: secret }), c);
      expect(res.status).toBe(200);
      await Promise.all(c.pending);
      expect(makeCalls()).toHaveLength(1);
      expect(slackTexts()[0]).toMatch(/^✅ \*COMPLETED\*: approved by ck at \d\d:\d\d HKT\. Make\.com accepted the hand-off \(HTTP 200\) for 6 posts/);
      expect(JSON.parse(makeCalls()[0][1].body).approved_by).toBe('ck');
    });
    it('falls back to the configured approver when Slack omits the user', async () => {
      const db = fakeD1(); seed(db, sixDrafts());
      const c = ctx();
      await worker.fetch(await slackReq({ ...click, user: undefined }), mkEnv(db, { SLACK_SIGNING_SECRET: secret }), c);
      await Promise.all(c.pending);
      expect(JSON.parse(makeCalls()[0][1].body).approved_by).toBe('chris');
      const db2 = fakeD1(); seed(db2, sixDrafts());
      const c2 = ctx();
      await worker.fetch(await slackReq({ ...click, user: undefined }), mkEnv(db2, { SLACK_SIGNING_SECRET: secret, SLACK_APPROVER: undefined }), c2);
      await Promise.all(c2.pending);
      expect(JSON.parse(makeCalls()[1][1].body).approved_by).toBe('chris');
    });
    it('logs (does not throw) when background processing fails', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const db = { prepare: () => { throw new Error('d1 gone'); } };
      const c = ctx();
      const res = await worker.fetch(await slackReq(click), mkEnv(db, { SLACK_SIGNING_SECRET: secret }), c);
      expect(res.status).toBe(200);
      await Promise.all(c.pending);
      expect(err).toHaveBeenCalledWith('approve failed', 'd1 gone');
    });
    it('rejects a bad signature, ignores clicks without actions, tolerates a missing payload', async () => {
      const env = mkEnv(fakeD1(), { SLACK_SIGNING_SECRET: secret });
      expect((await worker.fetch(await slackReq(click, { bad: true }), env, ctx())).status).toBe(401);
      expect((await worker.fetch(await slackReq({}), env, ctx())).status).toBe(200);
      // missing `payload` field: signed empty form
      const ts = String(Math.floor(Date.now() / 1000));
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:`));
      const empty = new Request('https://x.test/approve', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': ts, 'x-slack-signature': `v0=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}` }, body: '' });
      expect((await worker.fetch(empty, env, ctx())).status).toBe(200);
    });
  });
});
