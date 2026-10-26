// MPC-7494: the open mirror. Stubbed database, no network. Run: node workers/scan-report/recognise.test.mjs
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import {
  RECOGNITION_SIGNALS, TOTAL_WEIGHT, MIN_EVIDENCE, MIN_AGREEMENT, compareScans, recognise, toVisitorView, recognitionEnabled,
  handleRecognise, handleRecogniseDelete,
} from './lib/recognise.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

const HELD = '11111111-1111-4111-8111-111111111111';
const SAVED = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const base = {
  'canvas-fingerprint': 'a3f9c21e55aa', 'audio-fingerprint': '7be04d11c0de', 'webgl-fingerprint': 'ANGLE (Example GPU)', 'font-detection': '38 fonts',
  'screen-fingerprint': '1920×1080 @1x', 'hardware-profile': '8 cores / 8GB', 'timezone-locale': 'London (en-GB)',
  device: 'Desktop (Windows 11)', browser: 'Chrome 141', 'primary-language': 'English (UK)', 'language-fallbacks': 'French, German',
};
const scan = (over = {}, extra = []) => [
  ...Object.entries({ ...base, ...over }).filter(([, v]) => v !== null).map(([id, value]) => ({ id, label: id, value, status: 'found' })),
  // session-only hexagons that must never count
  { id: 'time', label: 'Time', value: 'Sun, 02:14 PM', status: 'found' }, { id: 'mouse-tracking', label: 'Mouse', value: '212 movements', status: 'found' },
  { id: 'location', label: 'Location', value: 'Springfield', status: 'found', estimate: true },
  ...extra,
];
const cand = (id, results, scanned_at = '2026-10-01T10:00:00Z') => ({ web_scan_id: id, scanned_at, results });

// ---- the signal list itself
const reg = new Map(HEXAGONS.map((h) => [h.id, h]));
check(RECOGNITION_SIGNALS.every((s) => reg.get(s.id)?.truth.level === 'measured'), 'every signal used is a hexagon the registry marks measured');
check(!RECOGNITION_SIGNALS.some((s) => ['location', 'isp', 'demographic', 'user-profile', 'google-services', 'time', 'session-duration', 'mouse-tracking', 'orientation', 'battery'].includes(s.id)), 'no estimate, cannot-be-checked or session-only hexagon is used');
check(TOTAL_WEIGHT === 20 && MIN_EVIDENCE === 12 && MIN_AGREEMENT === 0.85, 'threshold constants are the documented ones (20 points, 12 needed, 0.85)');

// ---- match
let r = compareScans(scan(), scan());
check(r.verdict === 'match' && r.agreement === 1 && r.evidence === 20 && r.matched.length === 11, 'match: same device, all 11 signals agree');
r = compareScans(scan(), scan({ browser: 'Chrome 142', 'screen-fingerprint': '2560×1440 @1x' }));
check(r.verdict === 'match' && r.agreed === 17 && Math.abs(r.agreement - 0.85) < 1e-9, 'match: a browser update plus a new monitor (3 points soft) is still the same device (exactly 0.85)');
const view = toVisitorView(recognise(scan(), [cand(SAVED, scan(), '2026-10-01T23:30:00Z')]));
check(view.recognised && view.scan_number === SAVED && view.last_seen === '2026-10-01' && view.signals.length === 11 && view.signals.every((s) => reg.has(s.id) && s.label === reg.get(s.id).label), 'match: the visitor is told the scan number, the day last seen and every signal, with registry labels');
check(!JSON.stringify(view).includes('a3f9c21e55aa') && !/email|contact|user/i.test(Object.keys(view).join(',')), 'match: no stored value and no contact or user field is returned');
check(/another device|identically/i.test(view.caveat), 'match: the screen is given the look-alike caveat');
const best = recognise(scan(), [cand(OTHER, scan({ browser: 'Chrome 1' }), '2026-10-05T00:00:00Z'), cand(SAVED, scan(), '2026-10-01T00:00:00Z')]);
check(best.recognised && best.scanNumber === SAVED, 'match: the better-agreeing scan wins over a more recent weaker one');

// ---- no match
r = compareScans(scan(), scan({ 'canvas-fingerprint': 'ffffffffffff' }));
check(r.verdict === 'hash_differs', 'no match: a different canvas hash vetoes, whatever else agrees');
r = compareScans(scan(), scan({ 'audio-fingerprint': 'eeeeeeeeeeee' }));
check(r.verdict === 'hash_differs', 'no match: a different audio hash vetoes');
const nm = recognise(scan(), [cand(OTHER, scan({ 'canvas-fingerprint': 'x1', 'audio-fingerprint': 'x2', 'webgl-fingerprint': 'ANGLE (Other)', 'screen-fingerprint': '800×600 @1x', 'hardware-profile': '2 cores', device: 'Mobile (Android)' }))]);
check(!nm.recognised, 'no match: a different device is not recognised');
check(!recognise(scan(), []).recognised && recognise(scan(), []).reason === 'no_candidates', 'no match: no saved scans');

// ---- below threshold
r = compareScans(scan(), scan({ 'font-detection': '12 fonts', 'screen-fingerprint': '800×600 @1x' }));   // 4 soft points differ, hashes agree
check(r.verdict === 'below_threshold' && r.agreed === 16 && r.agreement === 0.8, 'below threshold: hashes agree but 4 soft points differ (0.80 < 0.85)');
r = compareScans(scan(), scan({ browser: 'Firefox 120', device: 'Desktop (Linux)', 'primary-language': 'German', 'language-fallbacks': null, 'font-detection': '12 fonts' }));
check(r.verdict === 'below_threshold', 'below threshold: five soft signals differ');
const few = scan({ 'webgl-fingerprint': null, 'font-detection': null, 'screen-fingerprint': null, 'hardware-profile': null, 'timezone-locale': null, device: null });   // only the 2 hashes + 3 soft = 9
r = compareScans(few, few);
check(r.verdict === 'not_enough_evidence' && r.evidence === 9, 'below threshold: identical but only 9 of the 12 needed points are comparable => not enough evidence');
const noHash = scan({ 'canvas-fingerprint': null, 'audio-fingerprint': null });
check(compareScans(noHash, noHash).verdict !== 'match', 'below threshold: without a single agreeing hash there is never a match');
const statusless = scan().map(({ status, ...h }) => h);   // a scan saved before MPC-7487 has no statuses
check(compareScans(statusless, statusless).verdict === 'not_enough_evidence', 'below threshold: signals with no recorded FOUND status are not compared');
const notFound = scan().map((h) => (h.id === 'canvas-fingerprint' ? { ...h, status: 'not_checked' } : h));
check(compareScans(notFound, scan()).matched.includes('canvas-fingerprint') === false, 'below threshold: a NOT CHECKED value is never compared');

// ---- the handlers: stubbed database that records every call
// consent: true = the held scan has the save consent AND the recognise consent; 'save-only' = save consent but no recognise consent; false = neither.
// The stub answers the consent query the way the database would, by reading which columns the query requires.
function stub({ consent = true, candidates = [], found = true } = {}) {
  const calls = [];
  return {
    calls,
    sb: {
      async select(path) {
        calls.push(['select', path]);
        const needsRecognise = String(path).includes('recognise_consent_at=not.is.null'), needsSave = String(path).includes('save_consent_at=not.is.null');
        const hasSave = consent === true || consent === 'save-only', hasRecognise = consent === true;
        return (!needsSave || hasSave) && (!needsRecognise || hasRecognise) ? [{ id: 'link' }] : [];
      },
      async rpc(fn, args) { calls.push(['rpc', fn, args]); return fn === 'mpt_delete_web_scan' ? { found, scans_deleted: found ? 1 : 0 } : candidates; },
      async insert() { calls.push(['WRITE', 'insert']); throw new Error('write attempted'); },
      async insertMany() { calls.push(['WRITE', 'insertMany']); throw new Error('write attempted'); },
      async patch() { calls.push(['WRITE', 'patch']); throw new Error('write attempted'); },
      async remove() { calls.push(['WRITE', 'remove']); throw new Error('write attempted'); },
    },
  };
}
const ORIGINS = ['https://myprivacytool.io'];
const env = { RECOGNITION_ENABLED: 'true', WEB_SCAN_SAVE_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const json = (obj, status = 200) => ({ status, body: obj });
const req = (body, headers = {}) => new Request('https://x/api/recognise', { method: 'POST', body: JSON.stringify(body), headers });
const deps = (sb, limited = false) => ({ allowedOrigins: ORIGINS, rateLimited: async () => limited, sb });
const writes = (calls) => calls.filter((c) => c[0] === 'WRITE').length;

// match through the handler
let s = stub({ candidates: [cand(SAVED, scan())] });
let res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.status === 200 && res.body.recognised === true && res.body.scan_number === SAVED && res.body.signals.length === 11, 'handler match: recognised, with the matched scan number and signals');
check(writes(s.calls) === 0 && s.calls.every((c) => c[0] === 'select' || c[0] === 'rpc'), 'handler match: nothing is written, stored or logged anywhere (reads only)');
const rpc = s.calls.find((c) => c[0] === 'rpc');
check(rpc[1] === 'mpt_recognition_candidates' && rpc[2].p_hashes.length === 2 && rpc[2].p_hashes.every((h) => ['canvas-fingerprint', 'audio-fingerprint'].includes(h.id)), 'handler match: only the two hash values go to the database lookup');

// no match through the handler
s = stub({ candidates: [cand(OTHER, scan({ 'canvas-fingerprint': 'zzz' }))] });
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false && Object.keys(res.body).length === 1 && writes(s.calls) === 0, 'handler no match: {recognised:false} only, nothing written');
s = stub({ candidates: [cand(SAVED, scan({ 'font-detection': '12 fonts', 'screen-fingerprint': '800×600 @1x' }))] });
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false && Object.keys(res.body).length === 1, 'handler below threshold: not recognised, and the answer does not reveal how close it was');

// no consent
s = stub({ consent: false, candidates: [cand(SAVED, scan())] });
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false && !s.calls.some((c) => c[0] === 'rpc'), 'no consent: the held scan has no save-consent record => no comparison is run at all');
check(String(s.calls[0][1]).includes('save_consent_at=not.is.null') && String(s.calls[0][1]).includes('recognise_consent_at=not.is.null'), 'no consent: the check asks for BOTH specific consent records (save_consent_at and recognise_consent_at), not any link');
s = stub({ consent: 'save-only', candidates: [cand(SAVED, scan())] });
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false && Object.keys(res.body).length === 1 && !s.calls.some((c) => c[0] === 'rpc') && writes(s.calls) === 0, 'MPC-7494 opt-in: a held scan saved with the save consent but WITHOUT the recognise consent gets no comparison at all (same {recognised:false})');
s = stub({ candidates: [cand(SAVED, scan())] });
res = await handleRecognise({ ...env, RECOGNITION_ENABLED: 'false' }, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false && s.calls.length === 0, 'switch off: answers {recognised:false} and never touches the database');
res = await handleRecognise({ ...env, WEB_SCAN_SAVE_ENABLED: 'false' }, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false && s.calls.length === 0 && !recognitionEnabled({ RECOGNITION_ENABLED: 'true' }), 'switch off: recognition also needs scan saving to be on');
check(!recognitionEnabled({}) && !recognitionEnabled({ RECOGNITION_ENABLED: 'TRUE', WEB_SCAN_SAVE_ENABLED: 'true' }), 'switch: only the exact string "true" turns it on; default is off');
res = await handleRecognise(env, req({ hexagons: scan() }), '', json, deps(stub().sb));
check(res.status === 400, 'no consent: a request that holds no scan number is refused');
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD, email: 'a@b.co' }), '', json, deps(stub().sb));
check(res.status === 400, 'a request with any other field (for example an email) is refused: we do not take or use who the visitor is');
res = await handleRecognise(env, req({ hexagons: [{ id: 'x' }], held_scan_number: HELD }), '', json, deps(stub().sb));
check(res.status === 400, 'a malformed scan is refused');
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }, { Origin: 'https://evil.example' }), 'https://evil.example', json, deps(stub().sb));
check(res.status === 403, 'another origin is refused');
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(stub().sb, true));
check(res.status === 429, 'rate limited');
const failing = { calls: [], sb: { select: async () => [{ id: 1 }], rpc: async () => { const e = new Error('boom 123 secret'); e.status = 500; throw e; } } };
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(failing.sb));
check(res.body.recognised === false && res.status === 200, 'a database failure shows the visitor nothing (never a guess)');

// delete from the screen
s = stub({ found: true });
res = await handleRecogniseDelete(env, req({ scan_number: SAVED }), '', json, deps(s.sb));
check(res.body.deleted === true, 'delete from the screen: the visitor deletes the matched record by its scan number');
check(s.calls.length === 1 && s.calls[0][1] === 'mpt_delete_web_scan' && s.calls[0][2].p_scan_number === SAVED, 'delete from the screen: uses the MPC-7488 route (mpt_delete_web_scan) with exactly that scan number');
s = stub({ found: false });
res = await handleRecogniseDelete(env, req({ scan_number: OTHER }), '', json, deps(s.sb));
check(res.body.deleted === false, 'delete from the screen: an unknown scan number deletes nothing');
res = await handleRecogniseDelete(env, req({ scan_number: 'not-a-number' }), '', json, deps(stub().sb));
check(res.status === 400, 'delete from the screen: an invalid scan number is refused');
res = await handleRecogniseDelete(env, req({ scan_number: SAVED, all: true }), '', json, deps(stub().sb));
check(res.status === 400, 'delete from the screen: extra fields (no delete-everything) are refused');
s = stub();
res = await handleRecogniseDelete({ ...env, RECOGNITION_ENABLED: 'false' }, req({ scan_number: SAVED }), '', json, deps(s.sb));
check(res.body.deleted === false && s.calls.length === 0, 'delete from the screen: off when the switch is off');
// after a delete, the same device is no longer recognised
s = stub({ candidates: [] });
res = await handleRecognise(env, req({ hexagons: scan(), held_scan_number: HELD }), '', json, deps(s.sb));
check(res.body.recognised === false, 'after deletion the record is gone, so the next visit is not recognised');

// the module never writes
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./lib/recognise.js', import.meta.url), 'utf8');
check(!/\.(insert|insertMany|patch|remove)\(/.test(src) && !/sb\.rpc\('(?!mpt_recognition_candidates|mpt_delete_web_scan)/.test(src), 'source check: the recognise path calls no write; the only database functions are the read-only lookup and the MPC-7488 delete');

console.log(ok ? '\nALL PASSED' : '\nFAILURES');
process.exit(ok ? 0 : 1);
