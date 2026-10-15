// HITL loop: stubbed database, no network. Run: node workers/scan-report/hitl.test.mjs
import { HEXAGON_COUNT } from '../../shared/hexagon-registry/registry.js';
import { computeFinalRiskScore, handleFinalRiskScore, handleHexagonInteraction, validateInteraction } from './lib/hitl.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const SID = 'sess_0123456789abcdef';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const deps = (sb) => ({ allowedOrigins: ['https://myprivacytool.io'], rateLimited: async () => false, sb });
const env = { SUPABASE_SERVICE_ROLE_KEY: 'x' };
const post = (b) => new Request('https://w/api/scan/hexagon-interaction', { method: 'POST', body: JSON.stringify(b) });
const body = (over = {}) => ({ scan_session_id: SID, hexagon_id: 'browser', user_action: 'disputed', original_confidence_score: 0.4, osint_source: 'Truecaller', ...over });

// ---- validation
check(!validateInteraction(body()).error, 'valid payload accepted');
check(validateInteraction(body({ user_action: 'maybe' })).error, 'unknown action rejected');
check(validateInteraction(body({ hexagon_id: 'nope' })).error, 'unknown hexagon rejected');
check(validateInteraction(body({ original_confidence_score: 1.5 })).error, 'confidence outside 0..1 rejected');
check(validateInteraction(body({ scan_session_id: 'short' })).error, 'short session id rejected');
check(validateInteraction({ ...body(), extra: 1 }).error, 'unknown field rejected');

// ---- interaction endpoint
const calls = [];
const sb = (bound) => ({ rpc: async (fn, a) => { calls.push([fn, a]); return { bound }; } });
let res = await handleHexagonInteraction(env, post(body()), '', json, deps(sb(false)));
check(res.status === 403, 'unbound session -> 403');
res = await handleHexagonInteraction(env, post(body()), '', json, deps(sb(true)));
check(res.status === 200 && calls.at(-1)[0] === 'mpt_record_hexagon_interaction' && calls.at(-1)[1].p_user_action === 'disputed' && calls.at(-1)[1].p_osint_source === 'Truecaller', 'bound session -> 200, one rpc with the action and source');
res = await handleHexagonInteraction(env, post(body({ user_action: 'x' })), '', json, deps(sb(true)));
check(res.status === 400, 'invalid payload -> 400 without touching the database');
res = await handleHexagonInteraction(env, post(body()), 'https://evil.example', json, deps(sb(true)));
check(res.status === 403, 'foreign origin -> 403');
res = await handleHexagonInteraction(env, post(body()), '', json, deps({ rpc: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } }));
check(res.status === 500, 'database failure -> 500, not a false 200');

// ---- score maths
const scan = [
  { id: 'browser', status: 'found' }, { id: 'device', status: 'found' }, { id: 'screen-fingerprint', status: 'found' },
  { id: 'location', status: 'found' },       // estimate: never "checked" on its own
  { id: 'cookies-status', status: 'clear' }, { id: 'isp', status: 'not_checked' },
];
let r = computeFinalRiskScore(scan, []);
check(r.confirmed_hexagon_ids.join() === 'browser,device,screen-fingerprint', 'no clicks: only found + measured hexagons count (estimate, clear, not_checked excluded)');
r = computeFinalRiskScore(scan, [{ hexagon_id: 'browser', user_action: 'rejected', created_at: '2026-01-01' }, { hexagon_id: 'device', user_action: 'disputed', created_at: '2026-01-01' }]);
check(r.confirmed_hexagon_ids.join() === 'screen-fingerprint' && r.verified_exposures === 1, 'rejected (false_positive) and disputed are excluded');
r = computeFinalRiskScore(scan, [{ hexagon_id: 'location', user_action: 'confirmed', created_at: '2026-01-01' }]);
check(r.confirmed_hexagon_ids.includes('location'), 'a user-confirmed estimate counts');
r = computeFinalRiskScore(scan, [{ hexagon_id: 'browser', user_action: 'rejected', created_at: '2026-01-01' }, { hexagon_id: 'browser', user_action: 'confirmed', created_at: '2026-01-02' }]);
check(r.confirmed_hexagon_ids.includes('browser'), 'the latest interaction wins');
r = computeFinalRiskScore([], [{ hexagon_id: 'browser', user_action: 'confirmed', created_at: '1' }]);
check(r.score === Math.round(1 / HEXAGON_COUNT * 1000) / 10 && r.total_hexagons === HEXAGON_COUNT, `score = confirmed / ${HEXAGON_COUNT} * 100`);

// ---- score endpoint
const get = (q) => new Request(`https://w/api/scan/final-risk-score${q}`);
const sbGet = ({ session }) => ({ select: async (p) => p.startsWith('mpt_scan_sessions') ? (session ? [{ web_scan_id: '11111111-1111-4111-8111-111111111111' }] : []) : p.startsWith('mpt_hexagon_interactions') ? [{ hexagon_id: 'browser', user_action: 'rejected', created_at: '1' }] : [{ results: scan }] });
res = await handleFinalRiskScore(env, get(`?scan_session_id=${SID}`), '', json, deps(sbGet({ session: false })));
check(res.status === 403, 'score: unbound session -> 403');
res = await handleFinalRiskScore(env, get(''), '', json, deps(sbGet({ session: true })));
check(res.status === 400, 'score: missing scan_session_id -> 400');
res = await handleFinalRiskScore(env, get(`?scan_session_id=${SID}`), '', json, deps(sbGet({ session: true })));
const out = await res.json();
check(res.status === 200 && out.verified_exposures === 2 && !out.confirmed_hexagon_ids.includes('browser'), 'score: bound session returns the filtered score');

process.exit(ok ? 0 : 1);
