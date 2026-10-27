// @vitest-environment node
// CK-8482 Packages B, C, D: truthful receipts, bounded recovery, watchdog classification. Make and Slack are mocked; D1 is an
// in-memory fake. No test here can reach a live account: every fetch goes through the stubbed global.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker, { process as processApproval, recover } from './worker.js';
import { watchdogReport, expectedCycleIds, hmacHex, handleReceipt, backoffSeconds, parseRetryAfter, classifyCycle, missingCycles, rowsFor, MAX_ATTEMPTS } from './receipts.js';
import { PLATFORMS } from './schema.js';

const TASK = 'daily-posts-2026-10-21';
const MAKE_URL = 'https://hook.eu1.make.com/mock-token-abcd';
const SECRET = 'receipt-secret-for-tests';
const T0 = '2026-10-20T23:00:00.000Z';
const NOW = Date.parse(T0);
const COPY = { x: 'Short insight.', linkedin: 'LinkedIn copy', instagram: 'IG copy', facebook: 'FB copy', pinterest: 'Pin copy', youtube: 'YT copy' };
const URLS = { x: 'https://x.com/mpt/status/1', linkedin: 'https://www.linkedin.com/feed/update/urn:li:share:2', instagram: 'https://www.instagram.com/p/3', facebook: 'https://www.facebook.com/mpt/posts/4', pinterest: 'https://www.pinterest.com/pin/5', youtube: 'https://www.youtube.com/watch?v=6' };

/** In-memory D1 covering the statements issued by worker.js + receipts.js (small SQL subset, matched by shape). */
function fakeD1() {
  const t = { agent_execution_logs: [], social_metrics: [], make_webhook_log: [], publication_receipts: [], receipt_callbacks: [] };
  const prepare = (sql) => ({
    bind: (...a) => ({
      run: async () => {
        if (sql.startsWith('DELETE FROM agent_execution_logs')) { t.agent_execution_logs = t.agent_execution_logs.filter((r) => r[0] !== a[0]); return {}; }
        if (sql.startsWith('INSERT OR IGNORE INTO publication_receipts')) {
          if (!t.publication_receipts.some((r) => r.id === a[0])) t.publication_receipts.push({ id: a[0], content_id: a[1], platform: a[2], state: a[3], attempts: 0, outcome_unknown: 0, dead_letter: 0, next_attempt_at: null, handed_off_at: null, make_run_id: null, post_id: null, post_url: null, last_error: null, provenance: null, updated_at: a[4] });
          return {};
        }
        if (sql.startsWith('UPDATE publication_receipts')) {
          const set = sql.slice('UPDATE publication_receipts SET '.length, sql.indexOf(' WHERE '));
          const id = a[a.length - 1];
          const row = t.publication_receipts.find((r) => r.id === id);
          if (!row) return {};
          if (sql.includes("state IN ('drafted','approved','failed')") && !['drafted', 'approved', 'failed'].includes(row.state)) return {};
          if (sql.includes("state IN ('drafted','failed')") && (!['drafted', 'failed'].includes(row.state) || row.dead_letter)) return {};
          if (set.startsWith("state = 'handed_off', attempts = attempts + 1")) { Object.assign(row, { state: 'handed_off', attempts: row.attempts + 1, handed_off_at: a[0], make_run_id: a[1] ?? row.make_run_id, outcome_unknown: 0, last_error: null, next_attempt_at: null, updated_at: a[2] }); return {}; }
          if (set.startsWith("state = 'approved'")) { row.state = 'approved'; row.updated_at = a[0]; return {}; }
          set.split(', ').forEach((p, i) => { row[p.split(' = ')[0]] = a[i]; });
          return {};
        }
        const table = /INSERT INTO (\w+)/.exec(sql)[1];
        if (table === 'agent_execution_logs' && t.agent_execution_logs.some((r) => r[0] === a[0])) throw new Error('UNIQUE');
        if (table === 'receipt_callbacks') { if (t.receipt_callbacks.some((r) => r[0] === a[0])) throw new Error('UNIQUE'); }
        t[table].push(a);
        return {};
      },
      all: async () => {
        if (sql.startsWith('SELECT task_id, status')) return { results: t.agent_execution_logs.map((r) => ({ task_id: r[2], status: r[3] })) };
        if (sql.startsWith('SELECT * FROM publication_receipts WHERE content_id >=')) return { results: t.publication_receipts.filter((r) => r.content_id >= a[0]).map((r) => ({ ...r })) };
        if (sql.startsWith('SELECT * FROM publication_receipts')) return { results: t.publication_receipts.filter((r) => r.content_id === a[0]).map((r) => ({ ...r })) };
        if (sql.startsWith('SELECT receipt_id')) return { results: t.receipt_callbacks.filter((r) => r[0] === a[0]).map((r) => ({ receipt_id: r[0] })) };
        const [task, status] = a;
        return { results: t.agent_execution_logs.filter((r) => r[2] === task && r[3] === status).map((r) => ({ draft_content: r[5] })) };
      },
    }),
  });
  // recover() lists work with a bind-less SELECT DISTINCT; emulate it.
  const origPrepare = prepare;
  return { tables: t, prepare: (sql) => (sql.startsWith('SELECT DISTINCT content_id') ? { bind: () => ({ all: async () => ({ results: [...new Set(t.publication_receipts.filter((r) => (r.state === 'failed' && !r.dead_letter) || r.outcome_unknown).map((r) => r.content_id))].map((content_id) => ({ content_id })) }) }) } : origPrepare(sql)) };
}
const seedDrafts = (db) => PLATFORMS.forEach((p) => db.tables.agent_execution_logs.push([`d-${p}`, 't', TASK, 'drafted', null, JSON.stringify({ platform: p, copy: COPY[p], topic: 'Data brokers' })]));
const env = (db, extra = {}) => ({ AGENT_LOGS: db, MAKE_WEBHOOK_URL: MAKE_URL, DEFAULT_ASSET_URL: 'https://cdn.myprivacytool.io/a.png', SLACK_BOT_TOKEN: 'xoxb', SLACK_APPROVER: 'chris', RECEIPT_SIGNING_SECRET: SECRET, APPROVAL_API_TOKEN: 'tok', ...extra });
const approve = (db, extra) => processApproval(env(db, extra), { action: 'approve_all', taskId: TASK, timestamp: T0, approver: 'chris' });
const states = (db) => Object.fromEntries(db.tables.publication_receipts.map((r) => [r.platform, r.state]));

let makeImpl; let fetchMock;
const makeCalls = () => fetchMock.mock.calls.filter(([u]) => u === MAKE_URL);
const sentPlatforms = (i) => JSON.parse(makeCalls()[i][1].body).posts.map((p) => p.platform);
beforeEach(() => { makeImpl = async () => new Response('Accepted', { status: 200 }); fetchMock = vi.fn(async (u, init) => (u === MAKE_URL ? makeImpl(u, init) : new Response('{"ok":true}'))); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function signed(body, { ts = Math.floor(NOW / 1000), secret = SECRET } = {}) {
  const raw = JSON.stringify(body);
  return { raw, headers: new Headers({ 'x-receipt-timestamp': String(ts), 'x-receipt-signature': await hmacHex(secret, `${ts}.${raw}`) }) };
}
const receipt = (platform, extra = {}) => ({ receipt_id: `r-${platform}`, drafted_content_id: TASK, platform, status: 'published', make_run_id: 'run-77', post_id: `p-${platform}`, post_url: URLS[platform], published_at: '2026-10-21T00:05:00Z', ...extra });
const submit = async (db, body, opts) => { const s = await signed(body, opts); return handleReceipt(env(db), s.raw, s.headers, NOW); };

describe('B: a Make HTTP 200 is a hand-off, never a publication', () => {
  it('sets handed_off for every platform and nothing is verified_published', async () => {
    const db = fakeD1(); seedDrafts(db);
    expect((await approve(db)).status).toBe(200);
    expect(states(db)).toEqual(Object.fromEntries(PLATFORMS.map((p) => [p, 'handed_off'])));
    expect(db.tables.publication_receipts.every((r) => r.post_id === null && r.post_url === null)).toBe(true);
    expect(db.tables.social_metrics).toHaveLength(0);
  });
  it('verifies one platform from an authenticated receipt and records id, url, run id, time and provenance', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    const out = await submit(db, receipt('x'));
    expect(out).toMatchObject({ status: 200, state: 'verified_published' });
    const row = (await rowsFor(db, TASK)).find((r) => r.platform === 'x');
    expect(row).toMatchObject({ state: 'verified_published', post_id: 'p-x', post_url: URLS.x, make_run_id: 'run-77', provenance: 'callback:r-x', published_at: '2026-10-21T00:05:00.000Z' });
    expect(states(db).linkedin).toBe('handed_off');
    expect(db.tables.social_metrics).toHaveLength(1);
  });
  it('rejects absent, forged, stale and wrong-secret callbacks without changing state', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    const s = await signed(receipt('x'));
    expect((await handleReceipt(env(db), s.raw, new Headers(), NOW)).status).toBe(401);
    expect((await handleReceipt(env(db), s.raw, new Headers({ 'x-receipt-timestamp': String(Math.floor(NOW / 1000)), 'x-receipt-signature': 'ab'.repeat(32) }), NOW)).status).toBe(401);
    expect((await submit(db, receipt('x'), { secret: 'wrong' })).status).toBe(401);
    expect((await submit(db, receipt('x'), { ts: Math.floor(NOW / 1000) - 3600 })).status).toBe(401);
    const tampered = await signed(receipt('x'));
    expect((await handleReceipt(env(db), tampered.raw.replace('p-x', 'p-evil'), tampered.headers, NOW)).message).toBe('bad signature');
    expect((await handleReceipt({ ...env(db), RECEIPT_SIGNING_SECRET: undefined }, s.raw, s.headers, NOW)).status).toBe(503);
    expect(states(db).x).toBe('handed_off');
  });
  it('rejects receipts that do not match the intended content and platform', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    expect((await submit(db, receipt('x', { drafted_content_id: 'daily-posts-2026-10-22' }))).status).toBe(404);
    expect((await submit(db, receipt('reddit'))).status).toBe(404);
    expect((await submit(db, receipt('x', { post_url: 'https://evil.example.com/status/1' }))).message).toMatch(/does not belong/);
    expect((await submit(db, receipt('x', { post_url: 'http://x.com/a' }))).status).toBe(400);
    expect((await submit(db, receipt('x', { post_id: '' }))).status).toBe(400);
    expect((await submit(db, receipt('x', { post_url: 'not a url' }))).status).toBe(400); // a present URL must be valid
    expect((await submit(db, receipt('nope'))).status).toBe(400);
    expect(states(db).x).toBe('handed_off');
  });
  it('a replayed or duplicate callback is idempotent; a conflicting post id is refused', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    await submit(db, receipt('x'));
    expect(await submit(db, receipt('x'))).toMatchObject({ status: 200, message: 'duplicate receipt ignored' });
    expect(await submit(db, receipt('x', { receipt_id: 'r2' }))).toMatchObject({ status: 200, message: 'already verified' });
    expect((await submit(db, receipt('x', { receipt_id: 'r3', post_id: 'other' }))).status).toBe(409);
    expect(db.tables.publication_receipts.find((r) => r.platform === 'x').post_id).toBe('p-x');
    expect(db.tables.social_metrics).toHaveLength(1);
  });
  it('a platform-reported failure is recorded, due for a bounded retry, and never marks published', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    expect((await submit(db, { receipt_id: 'f1', drafted_content_id: TASK, platform: 'pinterest', status: 'failed', make_run_id: 'run-77', error: 'asset rejected' })).state).toBe('failed');
    expect(states(db).pinterest).toBe('failed');
  });
});

describe('C: bounded recovery without duplicate posts', () => {
  it('429 with Retry-After: schedules a retry at the provider delay and does not resend early', async () => {
    makeImpl = async () => new Response('slow down', { status: 429, headers: { 'retry-after': '900' } });
    const db = fakeD1(); seedDrafts(db);
    expect((await approve(db)).status).toBe(502);
    const r = db.tables.publication_receipts[0];
    expect(r.state).toBe('failed');
    expect(Date.parse(r.next_attempt_at) - Date.now()).toBeGreaterThan(800e3);
    makeImpl = async () => new Response('Accepted', { status: 200 });
    const early = await recover(env(db), { now: new Date() });
    expect(early.resent).toEqual([]);
    expect(makeCalls()).toHaveLength(1);
  });
  it('5xx: retries after backoff, sends only the failed platforms, then hands off', async () => {
    makeImpl = async () => new Response('bad gateway', { status: 502 });
    const db = fakeD1(); seedDrafts(db);
    await approve(db);
    makeImpl = async () => new Response('Accepted', { status: 200 });
    const later = new Date(Date.now() + 2 * 3600e3);
    const rep = await recover(env(db), { now: later });
    expect(rep.resent).toEqual([{ id: TASK, platforms: PLATFORMS }]);
    expect(states(db)).toEqual(Object.fromEntries(PLATFORMS.map((p) => [p, 'handed_off'])));
  });
  it('partial platform failure never re-posts platforms that already succeeded', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    for (const p of ['x', 'linkedin', 'instagram', 'facebook', 'youtube']) await submit(db, receipt(p));
    await submit(db, { receipt_id: 'f1', drafted_content_id: TASK, platform: 'pinterest', status: 'failed', make_run_id: 'run-77', error: 'rate limited' });
    const rep = await recover(env(db), { now: new Date(Date.now() + 60e3) });
    expect(rep.resent).toEqual([{ id: TASK, platforms: ['pinterest'] }]);
    expect(sentPlatforms(1)).toEqual(['pinterest']);
    expect(states(db)).toMatchObject({ x: 'verified_published', pinterest: 'handed_off' });
  });
  it('timeout after a possibly-delivered request: outcome is UNKNOWN, a duplicate approval does NOT resend', async () => {
    makeImpl = async () => { throw new Error('timeout'); };
    const db = fakeD1(); seedDrafts(db);
    expect((await approve(db)).status).toBe(502);
    expect(db.tables.publication_receipts.every((r) => r.outcome_unknown === 1 && r.state === 'approved')).toBe(true);
    makeImpl = async () => new Response('Accepted', { status: 200 });
    const again = await approve(db);
    expect(again).toMatchObject({ status: 200, message: 'in progress' }); // the claim is kept, so a second approval is a no-op
    expect((await recover(env(db), { now: new Date(Date.now() + 9e9) })).resent).toEqual([]); // no reconciler: unknown stays pending
    expect(makeCalls()).toHaveLength(1);
  });
  it('reconciliation: received -> handed_off (never resent); not_received -> resent once', async () => {
    makeImpl = async () => { throw new Error('timeout'); };
    const db = fakeD1(); seedDrafts(db); await approve(db);
    makeImpl = async () => new Response('Accepted', { status: 200 });
    const rec1 = await recover(env(db), { now: new Date(), reconcile: async () => 'received' });
    expect(rec1.resent).toEqual([]);
    expect(Object.values(states(db)).every((s) => s === 'handed_off')).toBe(true);
    expect(db.tables.publication_receipts[0].provenance).toBe('reconcile:recover');
    expect(makeCalls()).toHaveLength(1);

    makeImpl = async () => { throw new Error('timeout'); };
    const db2 = fakeD1(); seedDrafts(db2); await approve(db2);
    makeImpl = async () => new Response('Accepted', { status: 200 });
    const rec2 = await recover(env(db2), { now: new Date(Date.now() + 1000), reconcile: async () => 'not_received' });
    expect(rec2.resent).toEqual([{ id: TASK, platforms: PLATFORMS }]);
  });
  it('exhausted retries dead-letter the platform, alert, and stop sending', async () => {
    makeImpl = async () => new Response('down', { status: 503 });
    const db = fakeD1(); seedDrafts(db);
    db.tables.agent_execution_logs.push(['n', 't', TASK, 'notified', null, JSON.stringify({ channel: 'C1', ts: '1.2' })]);
    await approve(db);
    let alerts = 0;
    let at = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      at += 4 * 3600e3;
      const rep = await recover(env(db), { now: new Date(at) });
      alerts += rep.deadLettered.length;
    }
    expect(alerts).toBe(1);
    expect(db.tables.publication_receipts.every((r) => r.dead_letter === 1 && r.state === 'failed' && r.attempts === MAX_ATTEMPTS)).toBe(true);
    expect(makeCalls()).toHaveLength(MAX_ATTEMPTS);
    const slack = fetchMock.mock.calls.filter(([u]) => u === 'https://slack.com/api/chat.postMessage').map(([, i]) => JSON.parse(i.body).text);
    expect(slack.some((t) => /ALERT: retries exhausted/.test(t))).toBe(true);
  });
  it('worker restart: state is durable in D1, so a fresh recover() continues from the stored attempt count', async () => {
    makeImpl = async () => new Response('down', { status: 503 });
    const db = fakeD1(); seedDrafts(db); await approve(db);
    await recover(env(db), { now: new Date(Date.now() + 2 * 3600e3) });
    const attempts = db.tables.publication_receipts[0].attempts;
    expect(attempts).toBe(2); // approve + one recovery, counted across "restarts" because it lives in the table, not memory
  });
  it('recovery never sends for a rejected or never-approved cycle (publication approval intact)', async () => {
    const db = fakeD1(); seedDrafts(db);
    db.tables.publication_receipts.push({ id: `${TASK}:x`, content_id: TASK, platform: 'x', state: 'failed', attempts: 1, outcome_unknown: 0, dead_letter: 0, next_attempt_at: null });
    expect((await recover(env(db), { now: new Date() })).skipped).toEqual([{ id: TASK, reason: 'not_approved' }]);
    expect(makeCalls()).toHaveLength(0);
  });
  it('backoff and Retry-After helpers', () => {
    expect([1, 2, 3, 20].map((n) => backoffSeconds(n))).toEqual([60, 120, 240, 3600]);
    expect(backoffSeconds(1, 900)).toBe(900);
    expect(backoffSeconds(1, 99999)).toBe(3600);
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(new Date(NOW + 90e3).toUTCString(), new Date(NOW))).toBe(90);
    expect(parseRetryAfter('garbage')).toBe(0);
  });
});

describe('D: stage reporting separates approval-wait from failure', () => {
  it('awaiting approval is healthy and distinct', () => {
    const rows = PLATFORMS.map((platform) => ({ platform, state: 'drafted' }));
    expect(classifyCycle(rows)).toMatchObject({ healthy: true, stages: { awaiting_approval: 6, failed: 0 } });
  });
  it('flags overdue receipts, unknown outcomes and exhausted recovery', () => {
    const now = new Date(NOW);
    const rows = [
      { platform: 'x', state: 'handed_off', handed_off_at: new Date(NOW - 7 * 3600e3).toISOString() },
      { platform: 'linkedin', state: 'handed_off', handed_off_at: new Date(NOW - 3600e3).toISOString() },
      { platform: 'instagram', state: 'approved', outcome_unknown: 1 },
      { platform: 'facebook', state: 'failed', dead_letter: 1 },
      { platform: 'pinterest', state: 'verified_published' },
    ];
    const r = classifyCycle(rows, { now });
    expect(r.healthy).toBe(false);
    expect(r.problems.map((p) => p.kind).sort()).toEqual(['exhausted_recovery', 'overdue_receipt', 'unknown_outcome']);
    expect(r.stages).toMatchObject({ handed_off: 2, overdue: 1, verified_published: 1, dead_letter: 1, unknown_outcome: 1 });
  });
  it('detects missing daily cycles', () => {
    expect(missingCycles(['daily-posts-2026-10-20', 'daily-posts-2026-10-21'], ['daily-posts-2026-10-20'])).toEqual(['daily-posts-2026-10-21']);
  });
  it('POST /receipt and GET /status routes are authenticated and wired', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    const s = await signed(receipt('x'));
    const res = await worker.fetch(new Request('https://w/receipt', { method: 'POST', headers: s.headers, body: s.raw }), env(db), { waitUntil() {} });
    expect(res.status).toBe(401); // the fixed test clock is Oct 2026; wall-clock now is outside the 5 min tolerance
    expect((await worker.fetch(new Request('https://w/receipt'), env(db), {})).status).toBe(405);
    expect((await worker.fetch(new Request(`https://w/status?drafted_content_id=${TASK}`), env(db), {})).status).toBe(401);
    const ok = await worker.fetch(new Request(`https://w/status?drafted_content_id=${TASK}`, { headers: { authorization: 'Bearer tok' } }), env(db), {});
    const body = await ok.json();
    expect(body.platforms).toHaveLength(6);
    expect(body.stages.handed_off).toBe(6);
    expect(JSON.stringify(body)).not.toMatch(/tok|hook\.eu1/); // no secret material in status output
  });
});

describe('D: watchdog report and authenticated triggers', () => {
  const NOW_D = new Date('2026-10-27T03:00:00Z'); // 11:00 HKT on 2026-10-27
  const log = (id, status) => ({ task_id: id, status });
  it('expectedCycleIds lists HKT dates newest first', () => {
    expect(expectedCycleIds(NOW_D, 3)).toEqual(['daily-posts-2026-10-27', 'daily-posts-2026-10-26', 'daily-posts-2026-10-25']);
  });
  it('awaiting approval is reported but healthy; a cycle past its generation window with no drafts is a missing_cycle', () => {
    const ids = expectedCycleIds(NOW_D, 2);
    const ok = watchdogReport({ ids, logs: [log(ids[0], 'drafted'), log(ids[0], 'notified'), log(ids[1], 'drafted'), log(ids[1], 'approved'), log(ids[1], 'handed_off')], receipts: [], now: NOW_D });
    expect(ok.healthy).toBe(true);
    expect(ok.awaiting_approval).toEqual([ids[0]]);
    expect(ok.cycles.map((c) => c.stage)).toEqual(['awaiting_approval', 'handed_off']);
    const missing = watchdogReport({ ids, logs: [log(ids[1], 'drafted')], receipts: [], now: NOW_D });
    expect(missing.problems).toEqual([{ id: ids[0], kind: 'missing_cycle' }]);
    // before today's producer window plus grace has passed it is NOT yet missing
    expect(watchdogReport({ ids: [ids[0]], logs: [], receipts: [], now: new Date('2026-10-26T22:30:00Z') }).healthy).toBe(true);
  });
  it('flags generation failure, approved-but-never-sent, overdue receipts, unknown outcomes and dead letters', () => {
    const [a, b, c] = ['daily-posts-2026-10-27', 'daily-posts-2026-10-26', 'daily-posts-2026-10-25'];
    const r = watchdogReport({
      ids: [a, b, c],
      logs: [log(a, 'drafted'), log(a, 'failed'), log(b, 'drafted'), log(b, 'approved'), log(c, 'drafted'), log(c, 'approved'), log(c, 'handed_off')],
      receipts: [
        { content_id: c, platform: 'x', state: 'handed_off', handed_off_at: new Date(NOW_D - 8 * 3600e3).toISOString() },
        { content_id: c, platform: 'linkedin', state: 'approved', outcome_unknown: 1 },
        { content_id: c, platform: 'facebook', state: 'failed', dead_letter: 1 },
      ],
      now: NOW_D,
    });
    expect(r.healthy).toBe(false);
    const kinds = r.problems.map((p) => `${p.id.slice(-2)}:${p.kind}`).sort();
    expect(kinds).toEqual(['25:exhausted_recovery', '25:overdue_receipt', '25:unknown_outcome', '26:approved_not_sent', '27:generation_failed']);
  });
  it('a fully verified cycle is stage verified', () => {
    const id = 'daily-posts-2026-10-26';
    const r = watchdogReport({ ids: [id], logs: [log(id, 'drafted'), log(id, 'approved'), log(id, 'handed_off')], receipts: PLATFORMS.map((platform) => ({ content_id: id, platform, state: 'verified_published' })), now: NOW_D });
    expect(r.cycles[0].stage).toBe('verified');
    expect(r.healthy).toBe(true);
  });
  it('GET /watchdog and POST /recover require the bearer token; /recover is POST-only and sends nothing when nothing is due', async () => {
    const db = fakeD1(); seedDrafts(db);
    expect((await worker.fetch(new Request('https://w/watchdog'), env(db), {})).status).toBe(401);
    expect((await worker.fetch(new Request('https://w/recover', { method: 'POST' }), env(db), {})).status).toBe(401);
    const h = { authorization: 'Bearer tok' };
    expect((await worker.fetch(new Request('https://w/recover', { headers: h }), env(db), {})).status).toBe(405);
    const rec = await (await worker.fetch(new Request('https://w/recover', { method: 'POST', headers: h }), env(db), {})).json();
    expect(rec).toMatchObject({ ok: true, resent: [], deadLettered: [] });
    expect(makeCalls()).toHaveLength(0);
    const rep = await (await worker.fetch(new Request('https://w/watchdog?days=2', { headers: h }), env(db), {})).json();
    expect(rep).toHaveProperty('healthy');
    expect(rep.cycles).toHaveLength(2);
    expect(JSON.stringify(rep)).not.toMatch(/tok|hook\.eu1/);
  });
});

describe('routed platforms: only platforms Make can publish are sent, verified or monitored', () => {
  const routedEnv = (db) => env(db, { ROUTED_PLATFORMS: 'linkedin,facebook' });
  const go = (db) => processApproval(routedEnv(db), { action: 'approve_all', taskId: TASK, timestamp: T0, approver: 'chris' });
  it('sends only routed platforms and records the rest as not_routed (never handed off)', async () => {
    const db = fakeD1(); seedDrafts(db);
    expect((await go(db)).status).toBe(200);
    expect(sentPlatforms(0)).toEqual(['linkedin', 'facebook']);
    expect(states(db)).toEqual({ x: 'not_routed', linkedin: 'handed_off', instagram: 'not_routed', facebook: 'handed_off', pinterest: 'not_routed', youtube: 'not_routed' });
  });
  it('a receipt for a not_routed platform is refused; routed receipts verify and the cycle reads verified and healthy', async () => {
    const db = fakeD1(); seedDrafts(db); await go(db);
    expect((await submit(db, receipt('x'))).status).toBe(404);
    await submit(db, receipt('linkedin')); await submit(db, receipt('facebook'));
    const rows = await rowsFor(db, TASK);
    const rep = watchdogReport({ ids: [TASK], logs: db.tables.agent_execution_logs.map((r) => ({ task_id: r[2], status: r[3] })), receipts: rows, now: new Date(NOW) });
    expect(rep.cycles[0].stage).toBe('verified');
    expect(rep.healthy).toBe(true);
    expect(classifyCycle(rows).stages.not_routed).toBe(4);
  });
  it('recovery and duplicate approvals never send a not_routed platform', async () => {
    makeImpl = async () => new Response('down', { status: 503 });
    const db = fakeD1(); seedDrafts(db);
    await go(db);
    makeImpl = async () => new Response('Accepted', { status: 200 });
    const rep = await recover(routedEnv(db), { now: new Date(Date.now() + 2 * 3600e3) });
    expect(rep.resent).toEqual([{ id: TASK, platforms: ['linkedin', 'facebook'] }]);
    expect(sentPlatforms(makeCalls().length - 1)).toEqual(['linkedin', 'facebook']);
  });
  it('fails closed when ROUTED_PLATFORMS names nothing that was drafted', async () => {
    const db = fakeD1(); seedDrafts(db);
    const out = await processApproval(env(db, { ROUTED_PLATFORMS: 'tiktok' }), { action: 'approve_all', taskId: TASK, timestamp: T0, approver: 'chris' });
    expect(out.status).toBe(422);
    expect(makeCalls()).toHaveLength(0);
  });
  it('unset ROUTED_PLATFORMS keeps the legacy behaviour (all six sent)', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    expect(sentPlatforms(0)).toHaveLength(6);
  });
});

describe('post_url is optional but never invented', () => {
  it('a receipt without post_url verifies the platform and stores null; the post id and run id are still required', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    const { post_url, ...noUrl } = receipt('instagram');
    expect(post_url).toBeTruthy();
    expect(await submit(db, noUrl)).toMatchObject({ status: 200, state: 'verified_published' });
    const row = (await rowsFor(db, TASK)).find((r) => r.platform === 'instagram');
    expect(row).toMatchObject({ state: 'verified_published', post_id: 'p-instagram', post_url: null });
    expect((await submit(db, { ...noUrl, receipt_id: 'r9', post_id: '' })).status).toBe(400);
    expect((await submit(db, { ...receipt('facebook'), post_url: '' })).state).toBe('verified_published');
  });
  it('a URL that is present must still match the platform host', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    expect((await submit(db, receipt('linkedin', { post_url: 'https://www.facebook.com/x/1' }))).status).toBe(400);
    expect(states(db).linkedin).toBe('handed_off');
  });
});

describe('x-receipt-token authentication (what Make sends)', () => {
  const tokenSubmit = async (db, body, token) => handleReceipt(env(db), JSON.stringify(body), new Headers(token === undefined ? {} : { 'x-receipt-token': token }), NOW);
  it('accepts the shared secret as a token, rejects a wrong, empty or missing one, and still refuses unrelated platforms', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    expect((await tokenSubmit(db, receipt('linkedin'), 'wrong')).status).toBe(401);
    expect((await tokenSubmit(db, receipt('linkedin'), '')).status).toBe(401);
    expect((await tokenSubmit(db, receipt('linkedin'))).message).toBe('missing signature');
    expect(states(db).linkedin).toBe('handed_off');
    expect(await tokenSubmit(db, receipt('linkedin'), SECRET)).toMatchObject({ status: 200, state: 'verified_published' });
    expect((await tokenSubmit(db, receipt('linkedin'), SECRET)).message).toBe('duplicate receipt ignored'); // replay is a no-op
    expect((await tokenSubmit(db, receipt('x', { post_url: 'https://evil.example.com/1' }), SECRET)).status).toBe(400);
  });
  it('the HMAC path still works', async () => {
    const db = fakeD1(); seedDrafts(db); await approve(db);
    expect((await submit(db, receipt('facebook'))).state).toBe('verified_published');
  });
});
