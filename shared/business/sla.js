// MPC-9825: the 48-hour clock for staffed Business results. ONE implementation, used by the mpt-leads Worker (queue row, digest, Late sweep)
// and tested in shared/business/sla.test.mjs. Rule (Chris, 2026-11-07/08): "results within 48 hours" is a STAFFED manual service; the clock is
// plain elapsed hours from the moment the request row was created. Weekends and Hong Kong public holidays COUNT: nothing is paused, because
// the /business page promises 48 hours with no "working days" qualifier. Runbook: Notion "MPT > Business — 48-hour Results Runbook (v1)".

export const SLA_HOURS = 48;
export const DUE_SOON_HOURS = 12;          // inside this many hours of the deadline a request is "due soon" in the digest
export const DELAY_NOTICE_AT_HOURS = 36;   // not yet Approved by T+36h: Chris sends the honest delay email (runbook step 7)
export const STATUSES = ['New', 'In review', 'Approved', 'Sent', 'Late'];
export const OPEN_STATUSES = ['New', 'In review', 'Approved', 'Late'];   // everything except Sent

const HOUR = 3600 * 1000;
export const addHours = (d, h) => new Date(new Date(d).getTime() + h * HOUR);
export const dueAt = (receivedAt) => addHours(receivedAt, SLA_HOURS);
export const delayNoticeAt = (receivedAt) => addHours(receivedAt, DELAY_NOTICE_AT_HOURS);

// Hours left to the deadline (negative = overdue), one decimal.
export const hoursLeft = (due, now = new Date()) => Math.round(((new Date(due).getTime() - new Date(now).getTime()) / HOUR) * 10) / 10;

// 'sent' | 'late' | 'due_soon' | 'on_track'. A Sent request is never late afterwards; sentAt after the deadline is still recorded as late by the Worker.
export function slaState(row, now = new Date()) {
  if (row.status === 'Sent') return 'sent';
  const left = hoursLeft(row.due_at, now);
  if (left <= 0) return 'late';
  if (left <= DUE_SOON_HOURS) return 'due_soon';
  return 'on_track';
}

// Hong Kong time (UTC+8, no daylight saving) so the digest reads the way Chris lives it.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatHKT(d) {
  const h = new Date(new Date(d).getTime() + 8 * HOUR);
  const p = (n) => String(n).padStart(2, '0');
  return `${DAYS[h.getUTCDay()]} ${h.getUTCDate()} ${MONTHS[h.getUTCMonth()]} ${p(h.getUTCHours())}:${p(h.getUTCMinutes())} HKT`;
}
// True when the deadline lands on a Saturday or Sunday in Hong Kong: the digest flags it so a Friday-evening request is not forgotten.
export const dueOnWeekend = (due) => { const w = new Date(new Date(due).getTime() + 8 * HOUR).getUTCDay(); return w === 0 || w === 6; };

// 'BIZ-' + 8 characters from an alphabet without 0/O/1/I (readable aloud); same shape as the SUP- refs.
export function makeRef(randomBytes) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[randomBytes[i] % A.length];
  return 'BIZ-' + s;
}

// Daily digest text for Slack. Data minimisation (CK-7721): a ref, team size, status and times only. No name, email or company reaches Slack.
export function buildDigest(rows, now = new Date()) {
  const open = rows.filter((r) => r.status !== 'Sent');
  if (!open.length) return { text: ':white_check_mark: *MPT Business requests*: no open requests.', open: 0, late: 0, dueSoon: 0 };
  const sorted = [...open].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const states = sorted.map((r) => slaState(r, now));
  const late = states.filter((s) => s === 'late').length;
  const dueSoon = states.filter((s) => s === 'due_soon').length;
  const lines = sorted.map((r, i) => {
    const left = hoursLeft(r.due_at, now);
    const when = left <= 0 ? `${Math.abs(left)}h OVERDUE` : `${left}h left`;
    const mark = states[i] === 'late' ? ':rotating_light:' : states[i] === 'due_soon' ? ':warning:' : ':hourglass_flowing_sand:';
    const wk = dueOnWeekend(r.due_at) && states[i] !== 'late' ? ' (weekend deadline)' : '';
    return `${mark} ${r.ref} | ${r.status} | team ${r.team_size || '?'} | due ${formatHKT(r.due_at)} | ${when}${wk}`;
  });
  const head = `*MPT Business requests*: ${open.length} open, ${late} late, ${dueSoon} due within ${DUE_SOON_HOURS}h`;
  return { text: [head, ...lines, '', 'Runbook: Notion "MPT > Business — 48-hour Results Runbook (v1)". Change status in the Supabase table mpt_business_requests.'].join('\n'), open: open.length, late, dueSoon };
}

// Honest delay email to the REQUESTER (the address they gave on /business; no other recipient). Sent once, automatically, at T+36h if the request is still
// New or In review, so a missing reviewer produces a message instead of silence. Plain facts, no apology theatre, no new promise beyond the deadline.
export function delayEmail(row) {
  const first = String(row.contact_name || '').trim().split(/\s+/)[0] || 'there';
  const due = formatHKT(row.due_at);
  const lines = [
    `Hi ${first},`,
    '',
    `You asked MyPrivacyTOOL for a team exposure summary (reference ${row.ref}). We said results within 48 hours, which is ${due}.`,
    'It is not finished yet. A person prepares these by hand, and yours is still being put together. We are aiming to send it by that time.',
    'If it has not reached you by then, reply to this email and a person will answer you directly with where it stands.',
    '',
    'MyPrivacyTOOL',
  ];
  return { subject: `Your team summary ${row.ref}: not finished yet, due ${due}`, text: lines.join('\n') };
}
