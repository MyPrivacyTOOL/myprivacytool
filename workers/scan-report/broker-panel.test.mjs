// MPC-9814: the broker panel every surface renders (email-link page, /scan panel, report email). Stubbed, no network, synthetic data only.
// Run: node workers/scan-report/broker-panel.test.mjs
import { buildBrokerPanel, NOT_CHECKED_DEFAULT, NO_GUIDE_TEXT } from './lib/brokerPanel.js';
import { BROKER_SITES } from './lib/brokers.js';
import { buildReportEmail } from './lib/email.js';
import { computeScore } from './lib/score.js';
import { WEB_HEXAGONS } from './lib/reportHex.js';
import { checkEmail, HARD_LIMIT_BYTES } from './lib/renderChecks.js';
import { handleLive, makeLiveToken } from './lib/live.js';
import { fake } from './test-support/fake-backend.mjs';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const AT = { class: 'free', provider: 'user_supplied_page', method: 'page_read', checked_at: '2026-11-07T10:00:00.000Z' };
const res = (key, state, x = {}) => ({ key, name: key, state, match: null, confidence: null, is_guess: false, not_checked_reason: null, note: null, evidence_url: `https://${key}.example/p/1`, source: AT, guide: null, ...x });

// ---- nothing pasted: the honest free-tier mirror
const none = buildBrokerPanel(null);
check(none.rows.length === 9 && none.rows.map((r) => r.key).join() === BROKER_SITES.map((b) => b.key).join(), 'all nine shortlist brokers, in registry order, even with nothing pasted');
check(none.rows.every((r) => r.state === 'not_checked' && r.guide?.slug && r.confidence === null && r.evidence_url === null), 'each is not_checked with its guide, no confidence, no evidence');
check(none.rows.filter((r) => r.text === NOT_CHECKED_DEFAULT).length === 8 && /sign in/.test(none.rows[8].text), 'eight read the exact "we don\'t search... paste a page... paid coverage (coming)" sentence; Truecaller says why it cannot be read');
check(/Hong Kong and Singapore/.test(none.region_note) && /not live yet/.test(none.coverage_note), 'HK/SG honest line and the paid-coverage-not-live line travel with the panel');
check(!buildBrokerPanel(null, { pasteAvailable: false }).rows.some((r) => /paste/i.test(r.text)), 'paste check switched off: no row invites a paste');

// ---- states
const p = buildBrokerPanel({ pending: false, items: [
  res('spokeo', 'listed', { match: 'exact', confidence: 'high' }),
  res('mylife', 'listed', { match: 'possible', confidence: 'low', is_guess: true }),
  res('intelius', 'not_listed', { note: 'absent' }),
  res('truthfinder', 'not_listed', { note: 'page_gone' }),
  res('whitepages', 'not_checked', { not_checked_reason: 'fetch_blocked' }),
  res('other', 'listed', { name: 'somewhere.example', match: 'probable', confidence: 'medium' }),
] });
const by = (k) => p.rows.find((r) => r.key === k);
check(by('spokeo').state === 'listed' && by('spokeo').confidence_word === 'High' && by('spokeo').confidence_level === 3 && /matches what you told us/.test(by('spokeo').text), 'exact: Listed, High, 3 of 3');
check(by('mylife').is_guess && /We are guessing/.test(by('mylife').text) && by('mylife').confidence_level === 1, 'possible: labelled a guess in words, Low, 1 of 3');
check(by('intelius').state === 'not_listed' && by('intelius').confidence_word === 'Medium' && /about that one page only/.test(by('intelius').text) && /2026-11-07/.test(by('intelius').text), 'not listed: Medium, about that one page, dated');
check(by('truthfinder').confidence_word === 'High' && /no longer exists/.test(by('truthfinder').text), 'page gone: High, said in words');
check(by('whitepages').state === 'not_checked' && /would not let us read that page\. This is not a clear result/.test(by('whitepages').text) && !/not listed/i.test(by('whitepages').text), 'a blocked page is not checked, never not listed');
check(p.others.length === 1 && p.others[0].guide === null && p.others[0].no_guide_text === NO_GUIDE_TEXT && p.others[0].region === null, 'a non-shortlist site gets its own row and the general-method line, no invented guide');
check(by('beenverified').state === 'not_checked' && by('beenverified').text === NOT_CHECKED_DEFAULT, 'brokers with no page stay not checked beside a listed one');

// two pages for one broker: the strongest result leads, the other is kept as "also read"
const two = buildBrokerPanel({ items: [res('spokeo', 'not_checked', { not_checked_reason: 'timeout', evidence_url: 'https://spokeo.example/a' }), res('spokeo', 'listed', { match: 'probable', confidence: 'medium', evidence_url: 'https://spokeo.example/b' })] });
check(two.rows[0].state === 'listed' && two.rows[0].evidence_url === 'https://spokeo.example/b' && two.rows[0].also?.length === 1, 'two pages for one broker: strongest leads, the other kept');
check(buildBrokerPanel({ items: [res('spokeo', 'listed', { match: 'exact', evidence_url: 'javascript:alert(1)' })] }).rows[0].evidence_url === null, 'a non-https evidence link is dropped');
check(buildBrokerPanel(undefined).rows.length === 9 && buildBrokerPanel({ items: 'junk' }).rows.length === 9, 'never throws on bad input');

// ---- report email: under 100 KB with all nine pages pasted, long text, worst-case scan; markup and plain-text parity pass
const scan = { ...computeScore([{ category: 'email', risk: 7, ageDays: 0 }], new Set(['email'])), id: 'scan-1' };
const mix = WEB_HEXAGONS.map((h, i) => (i % 2 === 0 ? { id: h.id, status: 'found', value: `Value ${i} ${'x'.repeat(200)}` } : { id: h.id, status: 'not_checked' }));
const nine = BROKER_SITES.map((b, i) => res(b.key, ['listed', 'not_listed', 'not_checked'][i % 3], { match: i % 3 === 0 ? 'possible' : null, confidence: i % 3 === 0 ? 'low' : null, is_guess: i % 3 === 0, not_checked_reason: i % 3 === 2 ? 'fetch_blocked' : null, evidence_url: `https://www.${b.domains[0]}/${'p'.repeat(150)}` }));
const SN = '11111111-1111-4111-8111-111111111111';
const big = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', brokers: [], listings: { pending: false, items: [...nine, res('other', 'listed', { name: 'x'.repeat(100), match: 'exact', confidence: 'high' })] }, webScan: { id: SN, hexagons: mix }, unsubscribeLink: 'https://myprivacytool.io/unsubscribe?e=a%40b.co&t=abc' });
const bytes = Buffer.byteLength(big.html);
check(bytes < 100_000 && bytes < HARD_LIMIT_BYTES, `report email with all nine pages pasted: ${bytes} B HTML, under the 100 KB rule`);
const probs = checkEmail({ html: big.html, text: big.text, kind: 'report', scanNumber: SN, bridge: undefined });
check(probs.filter((x) => !/Part 1|bridge/.test(x)).length === 0, `markup and plain-text parity ok ${probs.join('; ')}`);
// snapshot of the section itself (stable wording, reviewed): the plain-text twin for the no-page case
const sec = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', brokers: [], webScan: null }).text;
const snap = sec.slice(sec.indexOf('BROKER SITES'), sec.indexOf('More removal guides'));
check(snap.startsWith('BROKER SITES\nWe check a broker site only when you paste the address of a page that lists you.') && /Spokeo \(US\): NOT CHECKED\n  Not checked\. We don't search broker sites for you\. Paste a page that lists you, or paid coverage \(coming\) will check for you\.\n  Confidence: none, nothing was checked\n  How to remove it: https:\/\/www\.spokeo\.com\/optout/.test(snap), 'section snapshot (no page pasted): intro, then Spokeo exactly as approved');

// ---- the live endpoint returns the panel for BOTH keys (the /scan request view and the email-link view)
const ID = '0eb12fbe-bf51-4186-9c12-0449fa526322';
const env = { UNSUBSCRIBE_SECRET: 's', SUPABASE_SERVICE_ROLE_KEY: 'k', EMAIL_CONFIRM_GATE_ENABLED: 'true', LISTING_CHECK_ENABLED: 'true' };
const F = fake();
F.db.scans.push({ id: ID, report_status: 'pending', email_confirm_required: true, email_confirmed_at: null });
const sb = { select: async (q) => (q.startsWith('scans?') ? F.db.scans.filter((s) => s.id === ID) : []) };
const tok = await makeLiveToken(env, ID);
const r = await handleLive(env, new Request(`https://x.test/api/scan/live?t=${encodeURIComponent(tok)}`), null, (b, st = 200) => new Response(JSON.stringify(b), { status: st }), { allowedOrigins: [], limited: async () => false, sb });
const body = await r.json();
check(r.status === 200 && body.broker_panel?.rows?.length === 9 && body.broker_panel.rows.every((x) => x.state === 'not_checked') && !('listings' in body), '/scan live view: the panel is there from the first poll, all nine not checked, no pasted-page detail');

console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
