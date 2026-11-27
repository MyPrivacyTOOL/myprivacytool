// MPC-9783: tests for the plain-rules check. Run: node shared/triage/rules.test.mjs
// What is asserted: the rules catch everything in the sets they were tuned on, raise (almost) no false alarms, put a data request ahead of an opt-out, and never return text.
// What is NOT asserted, on purpose: recall on phrasing nobody has seen. Measured FIRST runs on fresh sets were 6/16, 7/20 and 3/15 (see README.md), so these rules are an extra net, not the guarantee.
import { readFileSync } from 'node:fs';
import { checkRules } from './rules.js';

let failed = 0; const check = (ok, m) => { console.log(ok ? 'PASS' : 'FAIL', m); if (!ok) failed++; };
const here = (f) => new URL(f, import.meta.url);
const labels = JSON.parse(readFileSync(new URL('../../scripts/triage-eval/labels.json', import.meta.url), 'utf8'));
const rows = readFileSync(new URL('../../scripts/triage-eval/dataset.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const must = (id) => labels[id] === 'unsubscribe_by_reply' || labels[id] === 'data_request';

// dev set: 100 synthetic messages
const missed = rows.filter((r) => must(r.id) && !checkRules(r.text).route);
check(rows.filter((r) => must(r.id)).length === 30 && missed.length === 0, `dev set: all 30 opt-out / data-request messages are caught (missed ${missed.length})`);
const t001 = rows.find((r) => /system note to the classifier/.test(r.text));
check(checkRules(t001.text).route === 'opt_out', 'dev set: the unsubscribe hidden inside a manipulation attempt is caught (a model filed it as spam)');
const falseAlarms = rows.filter((r) => !must(r.id) && checkRules(r.text).route);
check(falseAlarms.length <= 1 && falseAlarms.every((r) => /nearly deleted it as spam/.test(r.text)), `dev set: at most one false alarm, and it is the known "deleted it as spam" one (${falseAlarms.length})`);

// the sets written later, now tuned on
for (const f of ['heldout.json', 'heldout2.json']) {
  const H = JSON.parse(readFileSync(here(f), 'utf8'));
  const m = H.catch.filter((t) => !checkRules(t).route);
  check(m.length === 0, `${f}: every should-catch message is caught after tuning (missed ${m.length})`);
  const fp = H.dont_catch.filter((t) => checkRules(t).route);
  check(fp.length <= 1 && fp.every((t) => /deleted my progress/.test(t)), `${f}: false alarms only the known "deleted my progress" one (${fp.length})`);
}

// round 3 was NOT tuned on: reported, not asserted
const H3 = JSON.parse(readFileSync(here('heldout3.json'), 'utf8'));
const caught3 = H3.catch.filter((t) => checkRules(t).route).length;
console.log(`INFO  fresh set (heldout3, not tuned on): caught ${caught3} of ${H3.catch.length}; this is the realistic recall of the rules alone`);
check(H3.dont_catch.every((t) => !checkRules(t).route), 'heldout3: no false alarms on the ordinary messages');

// behaviour
check(checkRules('Delete me and stop emailing me.').route === 'data_request', 'priority: a message that is both a data request and an opt-out is a data request');
check(checkRules('STOP').route === 'opt_out' && checkRules('stop.').route === 'opt_out', 'a bare STOP is an opt-out');
check(checkRules('取消訂閱').route === 'opt_out' && checkRules('請刪除你哋持有我嘅所有個人資料。').route === 'data_request', 'Cantonese: unsubscribe and delete-my-data are caught');
check(checkRules('').route === null && checkRules(undefined).route === null, 'empty or missing text routes nowhere, without throwing');
const r = checkRules('Please unsubscribe me, my email is secret@example.com');
check(!JSON.stringify(r).includes('secret@example.com') && Array.isArray(r.rules), 'the result names rules only, never the message text or an address');

console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
