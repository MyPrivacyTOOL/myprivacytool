// MPC-7556: daily per-type delivery numbers, the stated alert thresholds, and the Notion note line. Stubbed fetch. Run: node workers/mpt-metrics-collector/email-delivery.test.mjs
import collector, { notesLine, MIN_SENDS, BOUNCE_RATE_ALERT } from './collectors/email-delivery.js';
import { dailyProperties } from './publishers/notion.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const ENV = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const NOW = new Date('2026-11-05T16:15:00Z');   // 00:15 HKT on 6 Nov: the day to report is 5 Nov HKT
const real = globalThis.fetch;
const row = (email_type, sent, delivered, bounced, bounced_hard, complained, clicked) => ({ email_type, sent, delivered, bounced, bounced_hard, complained, clicked });
function stub(dayRows, weekRows, status = 200) {
  const calls = [];
  globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); calls.push(b); const isDay = (Date.parse(b.p_to) - Date.parse(b.p_from)) === 86400000; return { ok: status === 200, status, json: async () => (isDay ? dayRows : weekRows) }; };
  return calls;
}

let calls = stub([row('confirm', 4, 4, 0, 0, 0, 1), row('report', 4, 3, 1, 1, 0, 2), row('followup', 2, 2, 0, 0, 0, 0)], [row('confirm', 40, 40, 0, 0, 0, 5), row('report', 40, 39, 1, 1, 0, 9), row('followup', 20, 20, 0, 0, 0, 2)]);
let out = await collector.collect(ENV, NOW);
check(out.payload.day === '2026-11-05' && calls[0].p_from === '2026-11-04T16:00:00.000Z' && calls[0].p_to === '2026-11-05T16:00:00.000Z', 'reports the previous Hong Kong day (00:00-24:00 HKT)');
check(JSON.stringify(out.payload.by_type.report) === JSON.stringify({ sent: 4, delivered: 3, bounced: 1, bounced_hard: 1, complained: 0, clicked: 2 }), 'numbers per email type: sent, delivered, bounced, complained, clicked');
check(out.payload.totals.sent === 10 && out.payload.totals.clicked === 3, 'totals add up across types');
check(calls[1].p_to === calls[0].p_to && Date.parse(calls[1].p_to) - Date.parse(calls[1].p_from) === 7 * 86400000, 'the alert window is the 7 days ending at the same instant');
check(out.payload.window_7d.sent === 100 && out.payload.window_7d.hard_bounce_rate === 0.01 && out.payload.alert === false, '1 hard bounce in 100 sends (1%): below the 2% threshold, no alert');
check(collector.alertText({ status: 'ok', payload: out.payload }) === null, 'healthy: no alert text');
check(!JSON.stringify(out).includes('@'), 'no address anywhere in the payload');

stub([], [row('report', 100, 97, 3, 3, 0, 0)]);
out = await collector.collect(ENV, NOW);
let text = collector.alertText({ status: 'ok', payload: out.payload });
check(out.payload.alert === true && /hard-bounce rate 3\.0%/.test(text) && /3 of 100/.test(text) && /alert at 2%/.test(text), 'hard-bounce rate 3% over 100 sends: alert, with the numbers and the threshold');
stub([], [row('report', 10, 8, 2, 2, 0, 0)]);
out = await collector.collect(ENV, NOW);
check(out.payload.alert === false, `20% bounces on only 10 sends: no alert (minimum ${MIN_SENDS} sends, a rate on a handful is noise)`);
stub([], [row('followup', 50, 49, 0, 0, 1, 0)]);
out = await collector.collect(ENV, NOW);
text = collector.alertText({ status: 'ok', payload: out.payload });
check(out.payload.alert === true && /1 spam complaint/.test(text) && /opted out automatically/.test(text), 'a single complaint alerts, whatever the volume');
stub([], [row('followup', 5, 5, 0, 0, 1, 0)]);
check((await collector.collect(ENV, NOW)).payload.alert === true, 'a complaint alerts even on a handful of sends');
stub([], [row('report', 100, 98, 2, 2, 0, 0)]);
check(BOUNCE_RATE_ALERT === 0.02 && (await collector.collect(ENV, NOW)).payload.alert === true, 'exactly 2% hard bounces alerts (threshold is inclusive)');
stub([], [row('report', 100, 95, 5, 0, 0, 0)]);
check((await collector.collect(ENV, NOW)).payload.alert === false, 'soft bounces alone (not hard) do not trip the hard-bounce threshold');

stub([], [], 404);
let err = ''; try { await collector.collect(ENV, NOW); } catch (e) { err = e.message; }
check(/HTTP 404/.test(err), 'counts function missing (migration not applied): an error row, not a silent zero');
check(/could NOT be read/.test(collector.alertText({ status: 'error', error: err, payload: {} })), 'an unreadable source alerts too');
stub([], []);
out = await collector.collect(ENV, NOW);
check(out.payload.totals.sent === 0 && out.payload.alert === false, 'no emails sent: zeros, no alert');
globalThis.fetch = real;

// Notion daily row: counts only, honest about missing data
check(/confirm 4 sent\/4 delivered\/0 bounced\/0 complained\/1 clicked; report 4 sent\/3 delivered\/1 bounced\/0 complained\/2 clicked/.test(notesLine({ by_type: { confirm: row('confirm', 4, 4, 0, 0, 0, 1), report: row('report', 4, 3, 1, 1, 0, 2) } })), 'Notion note line: counts per email type');
check(/no emails sent/.test(notesLine({ by_type: {} })), 'Notion note line: an empty day says so');
const withMail = dailyProperties('2026-11-05', null, null, 'now', { by_type: { report: row('report', 4, 3, 1, 1, 0, 2) } });
check(/Email delivery \(counts per type/.test(withMail.Notes.rich_text[0].text.content) && !/@/.test(withMail.Notes.rich_text[0].text.content), 'Notion daily row carries the email counts, no address');
check(/Email delivery: not collected/.test(dailyProperties('2026-11-05', null, null, 'now', null).Notes.rich_text[0].text.content), 'Notion daily row: missing data is stated, not estimated');
check(!/Email delivery/.test(dailyProperties('2026-11-05', null, null, 'now').Notes.rich_text[0].text.content), 'callers that pass nothing see the old row unchanged');

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
