// MPC-9813: the pure checks and the not-configured path of the automated live check. No network.  Run: node scripts/f1-live-check/f1-live-check.test.mjs
import { checkConfirmationEmail, checkStoredResult, checkReportBlock, f1Body, FIXTURE_URL } from './checks.mjs';
import { runCheck, summary, STEPS } from './run.mjs';
import { isTestAddress } from '../../shared/test-records.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const good = { state: 'listed', match: 'exact', confidence: 'high', is_guess: false, evidence_url: FIXTURE_URL, source: { class: 'free', provider: 'user_supplied_page', method: 'page_read', checked_at: 'x' }, not_checked_reason: null, note: null };
check(checkStoredResult([good]).length === 0, 'a correct stored result passes');
check(checkStoredResult([{ ...good, state: 'not_checked', not_checked_reason: 'fetch_blocked' }]).length > 0, 'a blocked fixture fails the check (it is not Listed)');
check(checkStoredResult([{ ...good, note: 'Zelda Quillfeather' }]).some((p) => /page text/.test(p)), 'page text in the stored result fails the check');
check(checkStoredResult([]).length > 0 && checkStoredResult(null).length > 0, 'no result fails the check');
const bad = { state: 'listed', match: 'possible', confidence: 'low', is_guess: true, evidence_url: FIXTURE_URL, source: good.source };
check(checkStoredResult([bad]).length > 0, 'a guess is not accepted for the full-identity fixture');
check(checkReportBlock({ text: 'LISTINGS YOU SHOWED US\n- Page: LISTED, a match for the details you gave.\n' + FIXTURE_URL, html: '<h2>Listings you showed us</h2>' }).length === 0, 'a correct report block passes');
check(checkReportBlock({ text: 'nothing', html: '' }).length >= 3, 'a report without the block fails');
check(checkConfirmationEmail({ subject: 'Confirm your email to get your privacy report', text: "We only check details you’ve confirmed are yours. https://www.myprivacytool.io/scan/live#v=abc", html: 'Confirm this is my email' }).length === 0, 'a correct confirmation email passes');
check(checkConfirmationEmail({ subject: 'Your privacy scan is starting', text: '', html: '' }).length >= 3, 'the old confirmation email fails');
const body = f1Body('testingnt69+f1-x@gmail.com', []);
check(body.listing.urls[0] === FIXTURE_URL && body.listing.full_name === 'Zelda Quillfeather' && body['cf-turnstile-response'] === 'XXXX.DUMMY.TOKEN.XXXX', 'request body carries the synthetic identity, the fixture page and only the public test token');
const r = await runCheck({});
check(r.notConfigured && !r.ok && r.steps.every((s) => s.skipped), 'without configuration nothing runs and it is NOT reported as a pass');
check(summary(r).includes('NOT CONFIGURED') && STEPS.length === 13, 'summary says NOT CONFIGURED');
check(isTestAddress('testingnt69+f1-20261107-123@gmail.com') && !isTestAddress('someone@example.com'), 'the run alias is a test address');
console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
