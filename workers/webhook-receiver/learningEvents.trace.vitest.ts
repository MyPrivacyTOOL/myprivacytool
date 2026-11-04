// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// CK-8492: SYNTHETIC persistence trace. Real browser sender code (src/lib/learning/events.ts) -> the real Worker handler -> a thin PostgREST stand-in ->
// a THROWAWAY local Postgres that has every repo migration applied. Every assertion reads the rows back from Postgres; no response code is trusted as proof.
// Skipped unless LEARNING_TRACE_DATABASE_URL is set (a disposable database made by supabase/tests/run.sh); refuses anything that looks like Supabase.
// This is local evidence, not a staging run: no staging database exists, and nothing here touches production.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { recordAnswer, recordShown, resetShownForTests } from '../../src/lib/learning/events';

const URL_ = process.env.LEARNING_TRACE_DATABASE_URL ?? '';
const usable = URL_ !== '' && !/supabase\.(co|com)|pooler\.supabase/.test(URL_);
const BASE = 'https://api.synthetic.test';
const ENV = { LEARNING_EVENTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' };
const ORIGIN = { Origin: 'https://myprivacytool.io', 'Content-Type': 'application/json' };
const tile = { hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95 };
const SYNTH = (n: string) => `SYNTHETIC${n}`.padEnd(20, 'x');

const psql = (sql: string, ...args: string[]) =>
  execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', URL_, '-c', sql, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().replace(/\n?(SET|DELETE \d+|INSERT \d+ \d+)$/, '');
const rows = (where = 'true') => JSON.parse(psql(`select coalesce(json_agg(e order by created_at, event_type), '[]'::json) from public.mpt_hexagon_events e where ${where}`));
const count = (where = 'true') => Number(psql(`select count(*) from public.mpt_hexagon_events where ${where}`));

let logs: string[] = [];
let failed: number[] = [];
function install() {
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    if (!String(input).includes('/rest/v1/mpt_hexagon_events')) throw new Error('unexpected fetch ' + input);
    try {
      // The stand-in for PostgREST: insert the JSON body as service_role into the real table; a database error becomes a non-2xx like PostgREST's.
      // Only the columns present in the body are written, so column defaults (id, created_at) apply exactly as they do through PostgREST.
      const cols = Object.keys(JSON.parse(String(init.body))).filter((k) => /^[a-z_]+$/.test(k)).join(', ');
      const body = String(init.body).replace(/'/g, "''");
      psql(`set role service_role; insert into public.mpt_hexagon_events (${cols}) select ${cols} from json_populate_record(null::public.mpt_hexagon_events, '${body}'::json)`);
      return new Response('', { status: 201 });
    } catch (e: any) {
      const status = /duplicate key/.test(String(e.stderr)) ? 409 : 400;
      failed.push(status);
      return new Response(String(e.stderr), { status });   // PostgREST puts the Postgres message (with the key values) in the body
    }
  });
}
// The browser's fetch, pointed at the real Worker handler.
const viaWorker = async (url: string, init: RequestInit) => worker.fetch(new Request(url, { ...init, headers: { ...ORIGIN, ...(init.headers as any) } }), ENV, { waitUntil() {} });
const browser = (n: string, extra: Record<string, unknown> = {}) => ({ enabled: true, consent: true, base: BASE, personKey: SYNTH(n), fetchImpl: viaWorker as any, ...extra });

describe.skipIf(!usable)('SYNTHETIC trace: browser sender -> Worker -> Postgres (throwaway local database)', () => {
  beforeEach(() => {
    psql(`truncate public.mpt_hexagon_events, public.mpt_hexagon_event_rollups`);
    resetShownForTests(); logs = []; failed = []; install();
    for (const k of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, k).mockImplementation((...a: any[]) => { logs.push(a.map(String).join(' ')); });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('a shown event stores what was actually shown, and an answer links to that shown row', async () => {
    expect(await recordShown({ ...tile, tileKind: 'our_guess', confidence: 0.6 }, browser('a'))).toBe(true);
    expect(await recordAnswer({ ...tile, tileKind: 'our_guess', confidence: 0.6 }, 'not_me', browser('a'))).toBe(true);
    const [shown, answer] = rows(`person_key = '${SYNTH('a')}'`);
    expect(shown).toMatchObject({ event_type: 'shown', hexagon_id: 'location', tile_kind: 'our_guess', confidence_at_display: 0.6, answer: null, shown_event_id: null });
    expect(answer).toMatchObject({ event_type: 'answer', answer: 'not_me', tile_kind: 'our_guess', confidence_at_display: 0.6, shown_event_id: shown.id });
  });

  it('a closed dialog, a plain tap, a disabled switch, no consent and withdrawn consent store nothing', async () => {
    // Closing a prompt and a plain tap never call the sender at all (HexagonDashboard.learning.test.tsx pins that); the sender-level gates:
    expect(await recordShown(tile, browser('b', { enabled: false }))).toBe(false);
    resetShownForTests();
    expect(await recordShown(tile, browser('b', { consent: false }))).toBe(false);   // never consented, or consent withdrawn mid-session
    expect(await recordAnswer(tile, 'yes_me', browser('b', { consent: false }))).toBe(false);
    // Worker switch off: the route does not exist, even for a well-formed browser request
    const off = await worker.fetch(new Request(`${BASE}/api/learning/event`, { method: 'POST', headers: ORIGIN, body: JSON.stringify({ event_type: 'shown', person_key: SYNTH('b'), scan_window: 'w1', hexagon_id: 'location' }) }), { SUPABASE_SERVICE_ROLE_KEY: 'x' }, { waitUntil() {} });
    expect(off.status).toBe(404);
    expect(count()).toBe(0);
  });

  it('withdrawal after consent: earlier rows stay until deleted by the random code, later events are not stored', async () => {
    await recordShown(tile, browser('c'));
    expect(count()).toBe(1);
    expect(await recordAnswer(tile, 'yes_me', browser('c', { consent: false }))).toBe(false);   // visitor chose "Essential only"
    expect(count()).toBe(1);
    expect(psql(`delete from public.mpt_hexagon_events where person_key = '${SYNTH('c')}' returning 1`)).toBe('1');   // the documented manual deletion
    expect(count()).toBe(0);
  });

  it('rejected, malformed, oversized and origin-less requests store nothing', async () => {
    const post = (body: string, headers: Record<string, string> = ORIGIN) => worker.fetch(new Request(`${BASE}/api/learning/event`, { method: 'POST', headers, body }), ENV, { waitUntil() {} });
    const good = { event_type: 'shown', person_key: SYNTH('d'), scan_window: 'w1', hexagon_id: 'location' };
    expect((await post('{nope')).status).toBe(400);
    expect((await post(JSON.stringify({ ...good, hexagon_id: 'not-a-hexagon' }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...good, answer: 'yes_me' }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...good, pad: 'x'.repeat(3000) }))).status).toBe(413);
    expect((await post(JSON.stringify({ ...good, pad: 'é'.repeat(1500) }))).status).toBe(413);   // under 2048 characters, over 2048 bytes
    expect((await post(JSON.stringify(good), { 'Content-Type': 'application/json' })).status).toBe(403);
    expect(count()).toBe(0);
  });

  it('a duplicate shown and a replayed answer are stored once; a changed answer is kept; an answer with no shown, or a stale one, is refused', async () => {
    const e = (event_type: string, answer?: string, n = 'e', scan = 'w1') => ({ event_type, person_key: SYNTH(n), scan_window: scan, hexagon_id: 'location', source: 'web-scan', tile_kind: 'our_guess', confidence_at_display: 0.9, config_version: 0, ...(answer ? { answer } : {}) });
    const send = (b: any) => viaWorker(`${BASE}/api/learning/event`, { method: 'POST', body: JSON.stringify(b) });
    expect((await send(e('answer', 'yes_me'))).status).toBe(202);          // no shown first: the answer is refused by the database ...
    expect(count()).toBe(0);                                                // ... and nothing is stored, though the visitor still saw 202
    await send(e('shown')); await send(e('shown'));
    expect(count(`event_type = 'shown'`)).toBe(1);
    await send(e('answer', 'yes_me')); await send(e('answer', 'yes_me'));
    expect(count(`event_type = 'answer'`)).toBe(1);
    await send(e('answer', 'not_me'));
    expect(count(`event_type = 'answer'`)).toBe(2);
    psql(`update public.mpt_hexagon_events set created_at = now() - interval '30 hours' where event_type = 'shown'`);   // the shown event is now expired
    await send(e('answer', 'disputed'));
    expect(count(`answer = 'disputed'`)).toBe(0);
  });

  it('no finding value, email, phone or account id reaches the table or the logs, and the columns are exactly the contract', async () => {
    const body = { event_type: 'shown', person_key: SYNTH('f'), scan_window: 'w1', hexagon_id: 'location', source: 'web-scan', tile_kind: 'our_guess', confidence_at_display: 0.5, config_version: 0,
      finding_value: 'London', email: 'jo@example.com', phone: '+85212345678', account_id: 'acct_123' };
    await viaWorker(`${BASE}/api/learning/event`, { method: 'POST', body: JSON.stringify(body) });
    await viaWorker(`${BASE}/api/learning/event`, { method: 'POST', body: JSON.stringify(body) });   // duplicate: the database error would quote person_key
    const dump = psql(`select e::text from public.mpt_hexagon_events e`);
    expect(dump).not.toMatch(/London|jo@example|@|\+852|acct_/);
    expect(Object.keys(rows()[0]).sort()).toEqual(['answer', 'confidence_at_display', 'config_version', 'created_at', 'event_type', 'hexagon_id', 'id', 'person_key', 'scan_window', 'shown_event_id', 'source', 'tile_kind']);
    expect(failed).toEqual([409]);
    expect(logs.join('\n')).not.toMatch(/SYNTHETIC|London|jo@example|\+852|acct_/);
  });

  it('the purge keeps counts without person keys and removes the raw rows', async () => {
    psql(`set role service_role; insert into public.mpt_hexagon_events (event_type, person_key, scan_window, hexagon_id, created_at) values ('shown', '${SYNTH('g')}', 'w1', 'location', now() - interval '100 days')`);
    psql(`set role service_role; insert into public.mpt_hexagon_events (event_type, person_key, scan_window, hexagon_id, answer, created_at) values ('answer', '${SYNTH('g')}', 'w1', 'location', 'yes_me', now() - interval '100 days')`);
    expect(psql(`select public.rollup_and_purge_hexagon_events(interval '90 days')`)).toBe('2');
    expect(count()).toBe(0);
    expect(psql(`select shown_people || '/' || yes_me from public.mpt_hexagon_event_rollups where hexagon_id = 'location'`)).toBe('1/1');
    expect(psql(`select count(*) from information_schema.columns where table_name = 'mpt_hexagon_event_rollups' and column_name ilike '%person%'`)).toBe('0');
  });
});
