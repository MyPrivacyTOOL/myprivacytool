// MPC-7493: weekly learning-loop numbers from saved scans, appended to mpt_raw_metrics on Mondays (HKT) for the week that just ended.
// Calls public.mpt_learning_loop, which returns counts only: scans finished vs contacts given, the last step reached by leavers, how often each
// hexagon was shown as a finding to leavers vs stayers, average seconds on the results, and returns within 7 and 30 days.
// Nothing in the payload identifies a scan or a person. Only visitors who accepted the scan-saving consent have a saved scan at all.
import { previousHkWeek, hkWeekday } from '../lib/hk.js';

export const GRACE_HOURS = 24; // a scan younger than this at the end of the week may still leave a contact, so it is not yet counted as a leaver

export default {
  source: 'supabase',
  report: 'learning_loop_weekly',
  skip: (now) => hkWeekday(now) !== 1,
  async collect(env, now = new Date()) {
    const w = previousHkWeek(now);
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mpt_learning_loop`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_from: w.start.toISOString(), p_to: w.end.toISOString(), p_grace_hours: GRACE_HOURS }),
    });
    if (!res.ok) throw new Error(`mpt_learning_loop failed: HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload || typeof payload.finished !== 'number') throw new Error('mpt_learning_loop returned an unexpected shape');
    return { payload, period_start: w.start.toISOString(), period_end: w.end.toISOString() };
  },
};
