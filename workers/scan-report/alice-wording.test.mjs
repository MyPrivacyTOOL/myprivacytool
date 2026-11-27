// MPC-9826 (F7a): snapshot tests for the two Alice emails (confirmation and report), plus the wording rules behind them.
// A snapshot is the full text and HTML part. A wording change must be reviewed: run `UPDATE_SNAPSHOTS=1 node workers/scan-report/alice-wording.test.mjs`,
// read the diff in snapshots/, and commit it. Run: node workers/scan-report/alice-wording.test.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildConfirmationEmail, buildReportEmail } from './lib/email.js';
import { computeScore } from './lib/score.js';
import { REPLY_PROMISE, REPLY_SENTENCE, ALICE_COMING_SENTENCE, SIGN_OFF_LINES } from '../../shared/reply-wording.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const UNSUB = 'https://myprivacytool.io/unsubscribe?e=a%40b.co&t=abc';
const SCAN_NO = '11111111-1111-4111-8111-111111111111';
const LIVE = 'https://www.myprivacytool.io/scan/live#v=t';

const confirm = buildConfirmationEmail({ unsubscribeLink: UNSUB, liveLink: LIVE, scanNumber: SCAN_NO });
const confirmGate = buildConfirmationEmail({ unsubscribeLink: UNSUB, liveLink: LIVE, scanNumber: SCAN_NO, confirmGate: true });
const report = buildReportEmail({ scan: { ...computeScore([], new Set(['email'])), id: 'scan-1' }, breaches: [], breachStatus: 'checked', brokers: [], webScan: null, unsubscribeLink: UNSUB });

const snap = (name, value) => {
  const path = new URL(`./snapshots/${name}`, import.meta.url);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(path)) { writeFileSync(path, value); console.log(`WROTE ${name}`); return; }
  check(readFileSync(path, 'utf8') === value, `snapshot ${name} unchanged`);
};
snap('confirmation.txt', `${confirm.subject}\n\n${confirm.text}\n`);
snap('confirmation.html', `${confirm.html}\n`);
snap('confirmation-gated.txt', `${confirmGate.subject}\n\n${confirmGate.text}\n`);
snap('report.txt', `${report.subject}\n\n${report.text}\n`);
snap('report.html', `${report.html}\n`);

// Wording rules, so a snapshot refresh cannot quietly bring the old promise back.
const all = [confirm.text, confirm.html, confirmGate.text, report.text, report.html].join('\n');
check(!/open channel|continue the conversation|real person on our team|right here|from now on I.m your personal point of contact/i.test(all),
  'no sentence promises a conversation, an "open channel" or Alice as point of contact today');
for (const [n, m] of Object.entries({ confirm: confirm.text, gated: confirmGate.text, report: report.text })) {
  check(m.includes(REPLY_SENTENCE) && m.includes(ALICE_COMING_SENTENCE), `${n}: says a person answers, and marks the Alice conversation "(coming)"`);
}
check(confirm.text.includes('(coming)') && report.text.includes('(coming)'), 'plain-text marker "(coming)" is present');
check(!/working day|business day|instantly|right away|24 hours|within (one|\d+) (day|hour)/i.test(all), 'no reply-time promise (nothing shows the mailbox is monitored on a schedule)');
check(confirm.text.includes(`Talk soon,\n${SIGN_OFF_LINES[0]}\n${SIGN_OFF_LINES[1]}`) && /^Alice, MyPrivacyTOOL$/m.test(confirm.text) && /AI assistance/.test(confirm.text),
  'confirmation is signed "Alice, MyPrivacyTOOL" with AI assistance disclosed');
check(REPLY_PROMISE === `${REPLY_SENTENCE} ${ALICE_COMING_SENTENCE}`, 'shared reply promise is the two sentences, nothing more');

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all Alice wording checks passed');
