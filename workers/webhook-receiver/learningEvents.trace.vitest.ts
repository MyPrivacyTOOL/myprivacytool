// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// CK-8492 / MPC-9892: SYNTHETIC persistence trace. Real browser sender code (src/lib/learning/events.ts) -> the real Worker handler -> a thin PostgREST stand-in
// for the RPC -> a THROWAWAY local Postgres that has every repo migration applied. Every assertion reads the counters back from Postgres; no response code is proof.
// Since MPC-9892 there is no person key and no row: the only thing stored is a counter in public.learning_aggregate_daily.
// Skipped unless LEARNING_TRACE_DATABASE_URL is set (a disposable database made by supabase/tests/make-trace-db.sh); refuses anything that looks like Supabase.
// This is local evidence, not a staging run: no staging database exists, and nothing here touches production.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { recordAnswer, recordShown, resetShownForTests } from '../../src/lib/learning/events';

const URL_ = process.env.LEARNING_TRACE_DATABASE_URL ?? '';
const usable = URL_ !== '' && !/supabase\.(co|com)|pooler\.supabase/.test(URL_);
const BASE = 'https://myprivacytool-webhook-receiver.myprivacytool.workers.dev';   // the registered host (shared/recipients): the sender's wrapper refuses any other
const ENV = { LEARNING_EVENTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' };
const ORIGIN = { Origin: 'https://myprivacytool.io', 'Content-Type': 'application/json' };
const tile = { hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95 };

const psql = (sql: string) =>
  execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', URL_, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().replace(/\n?(SET|DELETE \d+|INSERT \d+ \d+)$/, '');
const cell = (key: string) => Number(psql(`select coalesce(sum(n), 0) from public.learning_aggregate_daily where dimension = 'tile_event' and key = '${key}'`));
const total = () => Number(psql(`select coalesce(sum(n), 0) from public.learning_aggregate_daily where dimension = 'tile_event'`));

let logs: string[] = [];
let failed: number[] = [];
function install() {
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const m = /\/rest\/v1\/rpc\/(mpt_learning_count_tile_event)$/.exec(String(input));
    if (!m) throw new Error('unexpected fetch ' + input);
    const a = JSON.parse(String(init.body));
    const lit = (v: unknown) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
    try {
      psql(`set role service_role; select public.mpt_learning_count_tile_event(${lit(a.p_hexagon_id)}, ${lit(a.p_event)}, ${lit(a.p_answer)})`);
      return new Response('', { status: 200 });
    } catch (e: any) {
      failed.push(400);
      return new Response(String(e.stderr), { status: 400 });
    }
  });
}
// The browser's fetch, pointed at the real Worker handler.
const viaWorker = async (url: string, init: RequestInit) => worker.fetch(new Request(url, { ...init, headers: { ...ORIGIN, ...(init.headers as any) } }), ENV, { waitUntil() {} });
const browser = (extra: Record<string, unknown> = {}) => ({ enabled: true, consent: true, base: BASE, fetchImpl: viaWorker as any, ...extra });

describe.skipIf(!usable)('SYNTHETIC trace: browser sender -> Worker -> Postgres counters (throwaway local database)', () => {
  beforeEach(() => {
    psql(`delete from public.learning_aggregate_daily`);
    resetShownForTests(); logs = []; failed = []; install();
    for (const k of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, k).mockImplementation((...a: any[]) => { logs.push(a.map(String).join(' ')); });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('a shown event and an answer each add 1 to a counter; no row per person exists', async () => {
    expect(await recordShown(tile, browser())).toBe(true);
    expect(await recordAnswer(tile, 'not_me', browser())).toBe(true);
    expect(await recordAnswer(tile, 'not_me', browser())).toBe(true);
    expect(cell('location:shown')).toBe(1);
    expect(cell('location:not_me')).toBe(2);
    expect(Number(psql(`select count(*) from public.learning_aggregate_daily`))).toBe(2);   // two cells, not three rows
  });

  it('a disabled switch, no consent and withdrawn consent count nothing', async () => {
    expect(await recordShown(tile, browser({ enabled: false }))).toBe(false);
    resetShownForTests();
    expect(await recordShown(tile, browser({ consent: false }))).toBe(false);
    expect(await recordAnswer(tile, 'yes_me', browser({ consent: false }))).toBe(false);
    // Worker switch off: the route does not exist, even for a well-formed browser request
    const off = await worker.fetch(new Request(`${BASE}/api/learning/event`, { method: 'POST', headers: ORIGIN, body: JSON.stringify({ event_type: 'shown', hexagon_id: 'location' }) }), { SUPABASE_SERVICE_ROLE_KEY: 'x' }, { waitUntil() {} });
    expect(off.status).toBe(404);
    expect(total()).toBe(0);
  });

  it('rejected, malformed, oversized and origin-less requests count nothing', async () => {
    const post = (body: string, headers: Record<string, string> = ORIGIN) => worker.fetch(new Request(`${BASE}/api/learning/event`, { method: 'POST', headers, body }), ENV, { waitUntil() {} });
    const good = { event_type: 'shown', hexagon_id: 'location' };
    expect((await post('{nope')).status).toBe(400);
    expect((await post(JSON.stringify({ ...good, hexagon_id: 'not-a-hexagon' }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...good, answer: 'yes_me' }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...good, pad: 'x'.repeat(3000) }))).status).toBe(413);
    expect((await post(JSON.stringify({ ...good, pad: 'é'.repeat(1500) }))).status).toBe(413);   // under 2048 characters, over 2048 bytes
    expect((await post(JSON.stringify(good), { 'Content-Type': 'application/json' })).status).toBe(403);
    expect(total()).toBe(0);
  });

  it('no person key, finding value, email, phone or account id reaches the table or the logs, even if a cached page still sends them', async () => {
    const body = { event_type: 'shown', hexagon_id: 'location', person_key: 'SYNTHETICfxxxxxxxxxx', scan_window: 'w1', tile_kind: 'our_guess', confidence_at_display: 0.5,
      finding_value: 'London', email: 'jo@example.com', phone: '+85212345678', account_id: 'acct_123' };
    expect((await viaWorker(`${BASE}/api/learning/event`, { method: 'POST', body: JSON.stringify(body) })).status).toBe(202);
    expect((await viaWorker(`${BASE}/api/learning/event`, { method: 'POST', body: JSON.stringify(body) })).status).toBe(202);   // a repeat is just +1: there is no per-person uniqueness to trip over
    expect(cell('location:shown')).toBe(2);
    const dump = psql(`select a::text from public.learning_aggregate_daily a`);
    expect(dump).not.toMatch(/SYNTHETIC|London|jo@example|@|\+852|acct_|w1|our_guess/);
    expect(psql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'learning_aggregate_daily'`)).toBe('day,dimension,key,n');
    expect(logs.join('\n')).not.toMatch(/SYNTHETIC|London|jo@example|\+852|acct_/);
  });

  it('a bad answer is refused by the database and logged without its text', async () => {
    const r = await viaWorker(`${BASE}/api/learning/event`, { method: 'POST', body: JSON.stringify({ event_type: 'shown', hexagon_id: 'Location;drop' }) });
    expect(r.status).toBe(400);   // refused by the Worker's own check, before the database
    expect(total()).toBe(0);
  });
});
