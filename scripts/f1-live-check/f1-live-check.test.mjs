// MPC-9813: the pure checks and the not-configured path of the automated live check. No network.  Run: node scripts/f1-live-check/f1-live-check.test.mjs
import { CONFIRM_LINK_RE, linkHosts, checkConfirmationEmail, checkStoredResult, checkReportBlock, f1Body, FIXTURE_URL } from './checks.mjs';
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
check(checkReportBlock({ text: 'BROKER SITES\nSpokeo (US): LISTED\n  We found a listing that matches what you told us (an exact match for the details you gave).\n  Evidence (the page): ' + FIXTURE_URL, html: '<h2>Broker sites</h2>' }).length === 0, 'the MPC-9814 report block passes');
check(checkReportBlock({ text: 'BROKER SITES\nSpokeo (US): NOT CHECKED\n  Not checked. We don\'t search broker sites for you.\n' + FIXTURE_URL, html: '<h2>Broker sites</h2>' }).length > 0, 'a broker section where the page is not Listed fails');
check(checkReportBlock({ text: 'nothing', html: '' }).length >= 3, 'a report without the block fails');
check(checkConfirmationEmail({ subject: 'Confirm your email to get your privacy report', text: "We only check details you’ve confirmed are yours. https://www.myprivacytool.io/scan/live#v=0eb12fbe-bf51-4186-9c12-0449fa526322.1794717443600.Nx0CLqaEFJ-yOLUkfnGAx4sAo4H2mPaV8mOVb6lzaQo", html: 'Confirm this is my email' }).length === 0, 'a correct confirmation email passes');
const TOKEN = '0eb12fbe-bf51-4186-9c12-0449fa526322.1794717443600.Nx0CLqaEFJ-yOLUkfnGAx4sAo4H2mPaV8mOVb6lzaQo';
const SENT = 'First, confirm this is your email. We only check details you’ve confirmed are yours. Until you press the confirm button.\nIf you did not ask for this, ignore this email and nothing happens:\n';
// the link exactly as the Worker writes it today (MPC-9814 follow-up: the UTM tags sit BEFORE the fragment, so "scan/live#v=" never occurs in the sent text)
const TAGGED = `https://www.myprivacytool.io/scan/live?utm_source=email&utm_medium=email&utm_campaign=scan-confirmation#v=${TOKEN}`;
const PLAIN = `https://www.myprivacytool.io/scan/live#v=${TOKEN}`;
const okEmail = (text) => checkConfirmationEmail({ subject: 'Confirm your email to get your privacy report', text, html: 'Confirm this is my email' });
check(CONFIRM_LINK_RE.test(TAGGED) && CONFIRM_LINK_RE.test(PLAIN), 'the signed confirm link is recognised with and without the email UTM tags');
check(okEmail(SENT + TAGGED).length === 0, 'the real UTM-tagged link passes the email check');
check(okEmail(SENT).some((x) => /lacks the signed confirm link/.test(x)), 'no link at all fails, naming where the links point');
check(okEmail(SENT + 'https://track.example-links.net/ls/click?upn=XYZ').some((x) => /track\.example-links\.net/.test(x)), 'a link that is not the signed /scan/live one fails, and the host is named');
check(!CONFIRM_LINK_RE.test('https://www.myprivacytool.io/scan/live#v=forged.1.sig'), 'a malformed token is not accepted as the signed link');
check(linkHosts('see https://a.example/x?t=1 and https://b.example/y').join() === 'a.example,b.example', 'link hosts are listed without paths or tokens');
// the Worker code itself: build the real confirmation email and require the matcher to find its link (this is the check that would have caught the wrong regex)
const { buildConfirmationEmail } = await import('../../workers/scan-report/lib/email.js');
const { makeLiveLink } = await import('../../workers/scan-report/lib/live.js');
const built = buildConfirmationEmail({ liveLink: await makeLiveLink({ UNSUBSCRIBE_SECRET: 'k'.repeat(64) }, '0eb12fbe-bf51-4186-9c12-0449fa526322'), confirmGate: true });
check(checkConfirmationEmail({ subject: built.subject, text: built.text, html: built.html }).length === 0, 'the email the Worker really builds passes the live check\'s own email check');
check(checkConfirmationEmail({ subject: 'Your privacy scan is starting', text: '', html: '' }).length >= 3, 'the old confirmation email fails');
const body = f1Body('testingnt69+f1-x@gmail.com', []);
check(body.listing.urls[0] === FIXTURE_URL && body.listing.full_name === 'Zelda Quillfeather' && body['cf-turnstile-response'] === 'XXXX.DUMMY.TOKEN.XXXX', 'request body carries the synthetic identity, the fixture page and only the public test token');
const r = await runCheck({});
check(r.notConfigured && !r.ok && r.steps.every((s) => s.skipped), 'without configuration nothing runs and it is NOT reported as a pass');
check(summary(r).includes('NOT CONFIGURED') && STEPS.length === 13, 'summary says NOT CONFIGURED');
check(isTestAddress('testingnt69+f1-20261107-123@gmail.com') && !isTestAddress('someone@example.com'), 'the run alias is a test address');
console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
