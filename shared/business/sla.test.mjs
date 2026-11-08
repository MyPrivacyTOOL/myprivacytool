// MPC-9825: deadline maths for the staffed Business 48-hour service. Run: node shared/business/sla.test.mjs
import { SLA_HOURS, dueAt, delayNoticeAt, hoursLeft, slaState, formatHKT, dueOnWeekend, makeRef, buildDigest } from './sla.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

check(SLA_HOURS === 48, 'SLA is 48 hours');
// Friday 2026-11-06 18:00 HKT = 10:00 UTC. Weekends COUNT: due Sunday 2026-11-08 18:00 HKT.
const fri = new Date('2026-11-06T10:00:00Z');
check(dueAt(fri).toISOString() === '2026-11-08T10:00:00.000Z', 'Friday 18:00 HKT request is due Sunday 18:00 HKT (weekend not skipped)');
check(formatHKT(dueAt(fri)) === 'Sun 8 Nov 18:00 HKT', 'deadline formats in Hong Kong time');
check(dueOnWeekend(dueAt(fri)) === true, 'Sunday deadline is flagged as a weekend deadline');
check(dueOnWeekend(dueAt(new Date('2026-11-09T02:00:00Z'))) === false, 'Monday 10:00 HKT request is due Wednesday: not a weekend deadline');
check(dueOnWeekend(new Date('2026-11-07T17:00:00Z')) === true, 'Sat 01:00 HKT (Fri 17:00 UTC) counts as Saturday in Hong Kong, not Friday');
check(delayNoticeAt(fri).toISOString() === '2026-11-07T22:00:00.000Z', 'delay notice trigger is T+36h');
// Month, year and leap-day boundaries are plain millisecond arithmetic.
check(dueAt(new Date('2026-12-31T23:30:00Z')).toISOString() === '2027-01-02T23:30:00.000Z', 'crosses the year boundary');
check(dueAt(new Date('2028-02-28T12:00:00Z')).toISOString() === '2028-03-01T12:00:00.000Z', 'crosses a leap day (2028)');
// No DST in Hong Kong or UTC: a request over a US/EU clock change still gets exactly 48h.
check(dueAt(new Date('2026-11-01T00:00:00Z')) - new Date('2026-11-01T00:00:00Z') === 48 * 3600e3, 'always exactly 48 elapsed hours');

const row = (status, due) => ({ ref: 'BIZ-AAAAAAAA', status, due_at: due, team_size: '11-50' });
const now = new Date('2026-11-08T00:00:00Z');
check(hoursLeft('2026-11-08T12:00:00Z', now) === 12, 'hoursLeft = 12');
check(hoursLeft('2026-11-07T22:30:00Z', now) === -1.5, 'overdue is negative');
check(slaState(row('New', '2026-11-09T00:00:00Z'), now) === 'on_track', '24h left is on track');
check(slaState(row('In review', '2026-11-08T12:00:00Z'), now) === 'due_soon', 'exactly 12h left is due soon');
check(slaState(row('New', '2026-11-08T00:00:00Z'), now) === 'late', 'exactly at the deadline counts as late');
check(slaState(row('Approved', '2026-11-07T00:00:00Z'), now) === 'late', 'approved but not sent past the deadline is late');
check(slaState(row('Sent', '2026-11-07T00:00:00Z'), now) === 'sent', 'a Sent request is never reported late');
check(slaState(row('Late', '2026-11-07T00:00:00Z'), now) === 'late', 'Late status is late');

const ref = makeRef(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 255]));
check(/^BIZ-[A-HJ-NP-Z2-9]{8}$/.test(ref), 'ref matches the table check constraint BIZ-[A-Z2-9]{8} and avoids 0/O/1/I');

check(buildDigest([], now).open === 0 && /no open requests/.test(buildDigest([], now).text), 'empty queue still produces a digest line');
check(buildDigest([row('Sent', '2026-11-07T00:00:00Z')], now).open === 0, 'Sent rows are not in the digest');
const d = buildDigest([row('New', '2026-11-09T00:00:00Z'), row('Late', '2026-11-07T22:30:00Z'), row('In review', '2026-11-08T12:00:00Z')], now);
check(d.open === 3 && d.late === 1 && d.dueSoon === 1, 'digest counts: 3 open, 1 late, 1 due soon');
const lines = d.text.split('\n');
check(lines[1].includes('OVERDUE') && lines[2].includes('12h left') && lines[3].includes('24h left'), 'digest sorts by deadline, overdue first');
check(!/@|contact|company/i.test(d.text.replace('Change status in the Supabase table mpt_business_requests.', '')), 'digest carries no name, email or company');
process.exit(ok ? 0 : 1);
