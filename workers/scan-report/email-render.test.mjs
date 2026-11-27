// MPC-7557: rendering checks on every email the Worker builds. Part of `npm run test:workers:node`, which CI runs on every pull request, so any change to the
// email code that breaks size, uses markup mail clients drop, or lets the plain text drift from the HTML fails the build.
// Static checks only: they do not prove how Gmail, Outlook or Apple Mail draw the message (see lib/renderChecks.js).
// Run: node workers/scan-report/email-render.test.mjs
import { buildReportEmail, buildConfirmationEmail, buildUnsubscribedEmail, buildUnsubscribeRequestEmail, BRIDGE } from './lib/email.js';
import { buildFollowUpEmail } from './lib/onboarding.js';
import { computeScore } from './lib/score.js';
import { WEB_HEXAGONS } from './lib/reportHex.js';
import { checkEmail, unsupportedMarkup, htmlLinks, HARD_LIMIT_BYTES } from './lib/renderChecks.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const UNSUB = 'https://myprivacytool.io/unsubscribe?e=a%40b.co&t=abc';
const SCAN_NO = '11111111-1111-4111-8111-111111111111';
const scan = { ...computeScore([{ category: 'email', risk: 7, ageDays: 0 }], new Set(['email'])), id: 'scan-1' };
const mix = WEB_HEXAGONS.map((h, i) => (i % 3 === 0 ? { id: h.id, status: 'found', value: `Value ${i}` } : { id: h.id, status: 'not_checked' }));
const report = buildReportEmail({ scan, breaches: [], breachStatus: 'checked', brokers: [], webScan: { id: SCAN_NO, hexagons: mix }, unsubscribeLink: UNSUB });
const noScan = buildReportEmail({ scan, breaches: [], breachStatus: 'not_checked', brokers: [], webScan: null, unsubscribeLink: UNSUB });

// Every email the Worker can build must pass.
const emails = {
  'report (saved scan)': [report, { kind: 'report', scanNumber: SCAN_NO, bridge: BRIDGE }],
  'report (no saved scan)': [noScan, { kind: 'report', bridge: BRIDGE }],
  'confirmation': [buildConfirmationEmail({ unsubscribeLink: UNSUB, liveLink: 'https://www.myprivacytool.io/scan/live#v=t', scanNumber: SCAN_NO }), { scanNumber: SCAN_NO }],
  'unsubscribe request': [buildUnsubscribeRequestEmail({ link: UNSUB }), {}],
  'unsubscribed': [buildUnsubscribedEmail(), {}],
  'follow-up day 3': [buildFollowUpEmail({ stage: 1, mirror: { found: 1 }, cohortNumber: 7, unsubscribeLink: UNSUB }), {}],
  'follow-up day 7': [buildFollowUpEmail({ stage: 2, mirror: { found: 1 }, cohortNumber: 7, unsubscribeLink: UNSUB }), {}],
};
for (const [name, [m, opts]] of Object.entries(emails)) {
  const problems = checkEmail({ html: m.html, text: m.text, ...opts });
  check(problems.length === 0, `${name}: size, markup, plain-text parity${problems.length ? ' -> ' + problems.join('; ') : ''}`);
}

// The checks themselves must catch what they claim to (mutation checks).
const bad = (html, text = 'plain', o = {}) => checkEmail({ html, text, ...o });
const GOOD = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><title>t</title></head><body><p>hi</p></body></html>';
check(bad(GOOD).length === 0, 'baseline minimal email passes');
check(bad(GOOD.replace('hi', 'x'.repeat(HARD_LIMIT_BYTES))).some((p) => /limit/.test(p)), 'catches an HTML part at or over 100 KB');
check(bad(GOOD.replace('<p>hi</p>', '<script>1</script>')).some((p) => /script/.test(p)), 'catches <script>');
check(bad(GOOD.replace('<p>hi</p>', '<form><input></form>')).length >= 2, 'catches <form> and <input>');
check(bad(GOOD.replace('<p>hi</p>', '<div style="display:flex">x</div>')).some((p) => /css/.test(p)), 'catches display:flex');
check(bad(GOOD.replace('<p>hi</p>', '<p onclick="x()">hi</p>')).some((p) => /event handler/.test(p)), 'catches inline event handlers');
check(bad(GOOD.replace('<p>hi</p>', '<img src="data:image/png;base64,AA" alt="x">')).some((p) => /https/.test(p)), 'catches a data: image');
check(bad(GOOD.replace('<p>hi</p>', '<img src="https://x/y.png">')).some((p) => /alt/.test(p)), 'catches an image without alt text');
check(bad(GOOD.replace('<p>hi</p>', '<a href="https://myprivacytool.io/a?b=1&amp;c=2">x</a>'), 'no link here').some((p) => /plain text lacks link/.test(p)), 'catches a link that is in the HTML but not the plain text');
check(bad(GOOD.replace('<p>hi</p>', '<a href="https://myprivacytool.io/a?b=1&amp;c=2">x</a>'), 'see https://myprivacytool.io/a?b=1&c=2').length === 0, 'an entity-escaped link matches its plain-text form');
check(bad(GOOD.replace('<meta name="viewport" content="width=device-width">', '')).some((p) => /viewport/.test(p)), 'catches a missing viewport meta');
check(bad(GOOD, '').some((p) => /plain-text/.test(p)), 'catches a missing plain-text part');
check(checkEmail({ html: report.html, text: report.text.replace(/NOT CHECKED/g, 'unknown'), kind: 'report' }).some((p) => /status tags/.test(p)), 'report: catches plain-text status tags drifting from the HTML');
check(checkEmail({ html: report.html.replace(/Part 2/g, 'Section 2'), text: report.text, kind: 'report' }).some((p) => /Part 1 \/ Part 2/.test(p)), 'report: catches a missing Part 2');
check(checkEmail({ html: report.html, text: report.text.replace(SCAN_NO, ''), kind: 'report', scanNumber: SCAN_NO }).some((p) => /scan number/.test(p)), 'report: catches a scan number missing from the plain text');
check(unsupportedMarkup(report.html).length === 0 && htmlLinks(report.html).length > 3, 'real report has no unsupported markup and its links are found');

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
