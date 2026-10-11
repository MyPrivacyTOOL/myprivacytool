// MPC-7468: two-part report email. Size limit, honest status, escaping, JSON attachment, no saved web scan.
// Run: node workers/scan-report/report-email.test.mjs   (set REPORT_RENDER_DIR=<dir> to also write the rendered HTML/text/JSON for review)
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildReportEmail, BRIDGE } from './lib/email.js';
import { computeScore } from './lib/score.js';
import { WEB_HEXAGONS, EMAIL_HEXAGONS, reportAttachment, MAX_VALUE } from './lib/reportHex.js';
import { loadWebScan } from './lib/webScanLoader.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const bytes = (s) => new TextEncoder().encode(s).length;
export const HARD_LIMIT = 100000, TARGET = 80000;
const UNSUB = 'https://myprivacytool.io/unsubscribe?e=a%40b.co&t=abc';
const BROKERS = [{ key: 'spokeo', name: 'Spokeo', removal_url: 'https://www.spokeo.com/optout', steps: ['Search', 'Paste the link', 'Confirm'], time_needed: '5 min', processing_time: '3 days' }, { key: 'mylife', name: 'MyLife', removal_url: null, steps: null }];

// Worst case: every web hexagon FOUND with the longest value made of characters that escape longest, every email hexagon found, many breaches.
const EVIL = '"<>&\'"'.repeat(60);
const worstWeb = { id: 'w1', created_at: '2026-10-11T00:00:00Z', hexagons: WEB_HEXAGONS.map((h) => ({ id: h.id, status: 'found', value: EVIL, detail: { raw: 'x'.repeat(100) } })) };
const worstEmail = EMAIL_HEXAGONS.filter((h) => h.id !== 'email-breaches').map((h) => ({ id: h.id, status: 'found', value: EVIL }));
const manyBreaches = Array.from({ length: 150 }, (_, i) => ({ Name: `Breach${i}"<b>`, BreachDate: '2019-05-01', DataClasses: ['Email addresses', 'Names', 'Phone numbers', 'Physical addresses', 'Passwords', 'IP addresses'] }));
const scan = { ...computeScore([{ category: 'email', risk: 7, ageDays: 0 }], new Set(['email'])), id: 'scan-123' };
const worst = buildReportEmail({ scan, breaches: manyBreaches, breachStatus: 'checked', brokers: BROKERS, webScan: worstWeb, emailChecks: worstEmail, unsubscribeLink: UNSUB });

// Realistic: a mix of statuses, normal values.
const mix = WEB_HEXAGONS.map((h, i) => (i % 3 === 0 ? { id: h.id, status: 'found', value: `Value for ${h.label}`, detail: { n: i } } : i % 3 === 1 && h.kind === 'risk' ? { id: h.id, status: 'clear' } : { id: h.id, status: 'not_checked' }));
const real = buildReportEmail({ scan, breaches: manyBreaches.slice(0, 3), breachStatus: 'checked', brokers: BROKERS, webScan: { id: 'w2', created_at: '2026-10-11T00:00:00Z', hexagons: mix }, unsubscribeLink: UNSUB });
const none = buildReportEmail({ scan: { ...computeScore([], new Set()), id: 'scan-9' }, breaches: [], breachStatus: 'not_checked', brokers: BROKERS, webScan: null, unsubscribeLink: UNSUB });

console.log(`sizes: worst ${bytes(worst.html)} B, realistic ${bytes(real.html)} B, no-web-scan ${bytes(none.html)} B (limit ${HARD_LIMIT}, target ${TARGET})`);
check(WEB_HEXAGONS.length === 54 && EMAIL_HEXAGONS.length === 4, 'registry: 54 web hexagons and 4 email hexagons');
check(bytes(worst.html) < HARD_LIMIT, `HARD LIMIT: worst-case HTML (all 54 web + all email hexagons found, hostile values) is under ${HARD_LIMIT} bytes`);
check(bytes(real.html) < TARGET, 'realistic report is under the 80 KB target');
for (const [k, m] of [['worst', worst], ['realistic', real]]) {
  const hexCount = (m.html.match(/FOUND|CHECKED AND CLEAR|NOT CHECKED/g) || []).length;
  check(hexCount >= 58, `${k}: all 54 web + 4 email hexagons are present (${hexCount} status tags)`);
}

// honest status
const cnt = (re, s) => (s.match(re) || []).length;
check(cnt(/>FOUND</g, real.html) + cnt(/>FOUND · ESTIMATE</g, real.html) === real.report.web_scan.summary.found + real.report.email.summary.found, 'status tags match the JSON tally');
const gap = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', brokers: [], webScan: { id: 'w', hexagons: [{ id: 'location', status: 'found', value: 'Springfield' }, { id: 'screen', status: 'clear' }, { id: 'nonsense', status: 'found', value: 'x' }] } });
const byId = Object.fromEntries(gap.report.web_scan.hexagons.map((h) => [h.id, h]));
check(byId.location.status === 'found' && byId.location.value === 'Springfield', 'FOUND shows the real value');
check(byId.screen.status === 'not_checked', 'a "clear" on an informational hexagon is NOT CHECKED (nothing to be clear of)');
check(byId.browser.status === 'not_checked' && gap.report.web_scan.hexagons.length === 54 && !byId.nonsense, 'hexagons missing from the saved scan are NOT CHECKED, never clear; unknown ids are ignored');
check(gap.report.email.hexagons.find((h) => h.id === 'email-breaches').status === 'clear' && gap.report.email.hexagons.filter((h) => h.status === 'not_checked').length === 3, 'email: breaches clear when checked and none; the three MPC-7467 checks are NOT CHECKED until they exist');
check(/ESTIMATE/.test(buildReportEmail({ scan, breaches: [], breachStatus: 'checked', webScan: { hexagons: [{ id: 'demographic', status: 'found', value: '25-34' }] } }).html), 'estimates are labelled ESTIMATE');

// escaping
check(!/<b>|<>|"<>/.test(worst.html.replace(/<\/?(b|i|a|div|span|td|tr|table|ul|li|img|strong|h1|h2|p|br|body|html|head|meta|title)\b[^>]*>/g, '')) && worst.html.includes('&lt;&gt;&amp;&#39;&quot;'), 'hostile values and breach names are escaped in the HTML');
check(!worst.html.includes(EVIL.slice(0, 12)), 'raw hostile value never appears unescaped');
check(Array.from(worstWeb.hexagons[0].value).length > MAX_VALUE && !worst.html.includes('&quot;'.repeat(MAX_VALUE)), 'long values are cut in the email (full value stays in the JSON)');
check(worst.report.web_scan.hexagons[0].value === EVIL, 'JSON attachment keeps the full value');

// links and tracking
const links = [...real.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const guide = links.filter((l) => l.includes('utm_content='));
check(guide.length === real.report.web_scan.summary.found + real.report.email.summary.found && guide.every((l) => /utm_source=email&amp;utm_medium=email&amp;utm_campaign=scan-report&amp;utm_content=[a-z0-9-]+$/.test(l)), 'one guide link per FOUND hexagon, each tagged utm_content=<hexagon id>');
check(new Set(guide.map((l) => l.split('utm_content=')[1])).size === guide.length, 'each tagged link carries a distinct hexagon id');
check(!/<img[^>]+(width="1"|height="1")/.test(real.html) && !/pixel|track\.gif/i.test(real.html), 'no tracking pixel');
check(!/data:image|base64/.test(real.html) && (real.html.match(/<img /g) || []).every((_, i, a) => true) && [...real.html.matchAll(/<img [^>]*src="([^"]+)"/g)].every((m) => m[1].startsWith('https://myprivacytool.io/email/')), 'artwork is linked from the site, never embedded');
check(real.html.includes(`href="${UNSUB.replace('&', '&amp;')}"`) && real.text.includes(UNSUB) && !/unsubscribe[^"]*utm_/.test(real.html + real.text), 'unsubscribe link present and untagged');
check(!/hexagons filled in|8 hexagons|Data broker profiles|AI threat/i.test(real.html + real.text), 'the 8 generic categories are gone');

// two parts, bridge, brokers, no-scan
check(real.html.includes('Part 1') && real.html.includes('Part 2') && real.html.indexOf(BRIDGE.replace(/'/g, '&#39;')) > real.html.indexOf('Part 1') && real.html.indexOf(BRIDGE) < real.html.indexOf('Part 2') && real.text.includes(BRIDGE), 'bridge line sits between Part 1 and Part 2 (HTML and text)');
check(/no saved web scan/i.test(none.text) && /no saved web scan/i.test(none.html) && none.report.web_scan.saved === false && none.report.web_scan.hexagons.length === 0 && /Part 2/.test(none.html), 'no saved web scan: still builds, Part 1 explained honestly, Part 2 present');
check(!/PEOPLE-SEARCH SITES/.test(none.text) && none.text.includes('/opt-out') && !none.html.includes('Open the official opt-out page'), 'people-search guides move to a link when no finding makes them relevant');
check(/PEOPLE-SEARCH SITES/.test(worst.text) && worst.html.includes('Open the official opt-out page'), 'people-search guides appear when a finding makes them relevant');
check(/Alice/.test(real.html) && real.html.includes('/email/alice/alice-peek.gif'), 'Alice is kept');

// text in step with HTML
const tagsText = cnt(/\[(FOUND|CHECKED AND CLEAR|NOT CHECKED)/g, real.text), tagsHtml = cnt(/>(FOUND|CHECKED AND CLEAR|NOT CHECKED)/g, real.html);
check(tagsText === tagsHtml && tagsText === 58, `plain text lists the same ${tagsText} hexagons as the HTML`);
check(cnt(/utm_content=/g, real.text) === guide.length, 'plain text carries the same tagged guide links');

// JSON attachment
const att = reportAttachment(real.report);
const parsed = JSON.parse(Buffer.from(att.content, 'base64').toString('utf8'));
check(/^my-privacy-scan-[a-z0-9-]+\.json$/.test(att.filename) && parsed.schema_version === 1 && parsed.web_scan.hexagons.length === 54 && parsed.email.hexagons.length === 4 && parsed.web_scan.hexagons.find((h) => h.status === 'found').detail !== undefined, 'JSON attachment decodes and carries all hexagons with detail');
check(!JSON.stringify(parsed).includes('@'), 'JSON attachment holds no email address');
check(Object.keys(parsed).sort().join() === 'email,generated_at,report_id,schema_version,score,web_scan', 'JSON top-level keys match docs/report-json-shape.md');

// loader (real MPC-7465 tables: web_scan_contacts links scans.id to web_scans.id)
const sb = (byTable) => ({ select: async (path) => { const t = path.split('?')[0]; if (byTable instanceof Error) throw byTable; return byTable[t] ?? []; } });
check(await loadWebScan(sb({}), 's') === null && await loadWebScan(sb(new Error('boom')), 's') === null, 'loader: no link or database error => null, never throws');
const ld = await loadWebScan(sb({ web_scan_contacts: [{ web_scan_id: 'ws1' }], web_scans: [{ id: 'ws1', created_at: 't', results: [{ id: 'location', label: 'Location', value: 'Springfield' }] }] }), 's');
check(ld.id === 'ws1' && ld.hexagons.length === 1, 'loader: follows web_scan_contacts to the saved web_scans row');

// the saved scan is what the browser reported (id, label, value, confirmed, ...): no status field
const browser = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', webScan: { id: 'w', hexagons: [
  { id: 'screen', label: 'Screen Resolution', value: '1920x1080', confirmed: true, confidence: 90, risk: 'low' },   // informational, code can tell: FOUND
  { id: 'location', label: 'Location', value: 'Springfield, Exampleshire', confirmed: true },                      // flagged 'cannot tell' in the registry: NOT CHECKED
  { id: 'browser', label: 'Browser', value: 'Unknown', confirmed: true },                                                    // placeholder: NOT CHECKED
  { id: 'google-services', label: 'Google Account', value: 'Not signed in', confirmed: true },                                // code cannot tell clear from not checked: NOT CHECKED
  { id: 'device', label: 'Device Type', value: '', confirmed: false },
] } });
const bh = Object.fromEntries(browser.report.web_scan.hexagons.map((h) => [h.id, h]));
check(bh.screen.status === 'found' && bh.screen.value === '1920x1080' && bh.screen.detail.confidence === 90, 'browser-shaped scan: a real value on a hexagon the code can tell apart is FOUND, with its technical detail kept');
check(bh.location.status === 'not_checked' && bh.browser.status === 'not_checked' && bh.device.status === 'not_checked' && bh['google-services'].status === 'not_checked', 'browser-shaped scan: placeholders, empty values and the "cannot tell" hexagons are NOT CHECKED, never clear');
check(bh['google-services'].reported_value === 'Not signed in' && bh['google-services'].value === null, 'a NOT CHECKED hexagon keeps what the browser reported in the JSON only');
check(browser.report.web_scan.hexagons.every((h) => h.status !== 'clear'), 'a browser-shaped scan never produces CLEAR (the code cannot tell)');

if (process.env.REPORT_RENDER_DIR) {
  mkdirSync(process.env.REPORT_RENDER_DIR, { recursive: true });
  for (const [k, m] of [['worst', worst], ['realistic', real], ['no-web-scan', none]]) {
    writeFileSync(`${process.env.REPORT_RENDER_DIR}/${k}.html`, m.html); writeFileSync(`${process.env.REPORT_RENDER_DIR}/${k}.txt`, m.text); writeFileSync(`${process.env.REPORT_RENDER_DIR}/${k}.json`, JSON.stringify(m.report, null, 2));
  }
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all report email checks passed');
