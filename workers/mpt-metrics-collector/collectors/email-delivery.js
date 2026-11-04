// MPC-7556: daily delivery numbers per email type, from public.email_sends (written by the scan-report Worker from the provider's signed events). Counts only; no address.
//   sent, delivered, bounced, bounced_hard, complained, clicked (provider click events on our tagged links; no tracking pixels, opens are not counted).
// Also a rolling 7-day window for the alert. Test sends (the owner's test mailbox) are excluded in SQL, so they never count in KPIs.
//
// ALERT THRESHOLDS (stated, deliberately well below the provider's own limits of about 4 percent bounces and 0.08 percent complaints):
//   hard-bounce rate of 2 percent or more across the last 7 days, provided at least 20 emails were sent in the window (a rate on 3 emails is noise), OR
//   one or more complaints in the last 7 days (at our volume a single complaint is already well above 0.08 percent, and each one also opts that address out).
import { previousHkDay } from '../lib/hk.js';

export const MIN_SENDS = 20;
export const BOUNCE_RATE_ALERT = 0.02;
export const COMPLAINT_ALERT = 1;
const DAY_MS = 86400000;
const num = (v) => Number(v) || 0;

async function counts(env, from, to) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mpt_email_delivery_counts`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_from: from.toISOString(), p_to: to.toISOString() }),
  });
  if (!res.ok) throw Object.assign(new Error(`email-delivery: counts read failed: HTTP ${res.status}`), { status: res.status });
  return (await res.json()).map((r) => ({ email_type: r.email_type, sent: num(r.sent), delivered: num(r.delivered), bounced: num(r.bounced), bounced_hard: num(r.bounced_hard), complained: num(r.complained), clicked: num(r.clicked) }));
}
const total = (rows) => rows.reduce((t, r) => ({ sent: t.sent + r.sent, delivered: t.delivered + r.delivered, bounced: t.bounced + r.bounced, bounced_hard: t.bounced_hard + r.bounced_hard, complained: t.complained + r.complained, clicked: t.clicked + r.clicked }), { sent: 0, delivered: 0, bounced: 0, bounced_hard: 0, complained: 0, clicked: 0 });
const byType = (rows) => Object.fromEntries(rows.map(({ email_type, ...n }) => [email_type, n]));

export default {
  source: 'supabase',
  report: 'email_delivery_daily',
  async collect(env, now = new Date()) {
    const win = previousHkDay(now);
    const day = await counts(env, win.start, win.end);
    const week = total(await counts(env, new Date(win.end.getTime() - 7 * DAY_MS), win.end));
    const hardRate = week.sent ? week.bounced_hard / week.sent : 0;
    const alert = (week.sent >= MIN_SENDS && hardRate >= BOUNCE_RATE_ALERT) || week.complained >= COMPLAINT_ALERT;
    return {
      payload: {
        day: win.day, by_type: byType(day), totals: total(day),
        window_7d: { ...week, hard_bounce_rate: Math.round(hardRate * 10000) / 10000 },
        thresholds: { hard_bounce_rate: BOUNCE_RATE_ALERT, min_sends: MIN_SENDS, complaints: COMPLAINT_ALERT },
        alert,
      },
      period_start: win.start.toISOString(), period_end: win.end.toISOString(),
    };
  },
  alertText(row) {
    if (row.status === 'error') return `:rotating_light: Daily email delivery numbers could NOT be read (${row.error || 'unknown error'}). Bounces and complaints are not being watched until this is fixed.`;
    const p = row.payload || {}, w = p.window_7d || {};
    const lines = [];
    if (w.complained >= COMPLAINT_ALERT) lines.push(`${w.complained} spam complaint(s) in the last 7 days (each complaint address is opted out automatically).`);
    if (w.sent >= MIN_SENDS && w.hard_bounce_rate >= BOUNCE_RATE_ALERT) lines.push(`hard-bounce rate ${(w.hard_bounce_rate * 100).toFixed(1)}% over the last 7 days (${w.bounced_hard} of ${w.sent} emails; alert at ${BOUNCE_RATE_ALERT * 100}%).`);
    return lines.length ? `:rotating_light: Email deliverability: ${lines.join(' ')} Look at the per-type numbers on the Notion daily row and in mpt_raw_metrics (email_delivery_daily). Counts only; no addresses in this message.` : null;
  },
};

/** One line for the Notion daily row Notes: counts per email type. Empty when nothing was sent. */
export function notesLine(payload) {
  const t = payload?.by_type || {};
  const parts = Object.entries(t).map(([k, n]) => `${k} ${n.sent} sent/${n.delivered} delivered/${n.bounced} bounced/${n.complained} complained/${n.clicked} clicked`);
  return parts.length ? `Email delivery (counts per type, sends of this HKT day, test sends excluded): ${parts.join('; ')}.` : 'Email delivery: no emails sent this day (or delivery tracking not yet recording).';
}
