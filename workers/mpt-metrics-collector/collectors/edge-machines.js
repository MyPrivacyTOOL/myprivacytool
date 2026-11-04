// Machine mirror collector (MPC-7492). One source=edge, report=machine_daily row per run for the previous complete Hong Kong day:
// per bot or AI family: requests, pages taken, first and last seen, share of all traffic, whether it fetched robots.txt; plus change flags.
// Reads only the aggregate public.mpt_machine_visits_daily (counts and paths, no IP, no person or unknown rows) and stores no raw rows.
import { previousHkDay } from '../lib/hk.js';
import { rollup, flags } from '../lib/machine-mirror.js';

const DAY_MS = 86400000;

async function aggregate(env, from, to) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mpt_machine_visits_daily`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_from: from.toISOString(), p_to: to.toISOString() }),
  });
  if (!res.ok) throw new Error(`mpt_machine_visits_daily failed: HTTP ${res.status}`);
  return res.json();
}

export default {
  source: 'edge',
  report: 'machine_daily',
  async collect(env, now = new Date()) {
    const p = previousHkDay(now);
    const prevStart = new Date(p.start.getTime() - DAY_MS);
    const [today, prev] = [await aggregate(env, p.start, p.end), await aggregate(env, prevStart, p.start)];
    const families = rollup(today);
    const total = Number(today.total_requests) || 0;
    const machine = Number(today.machine_requests) || 0;
    return {
      period_start: p.start.toISOString(), period_end: p.end.toISOString(),
      payload: {
        day: p.day,
        total_requests: total,
        machine_requests: machine,
        machine_share_pct: total > 0 ? Math.round((machine / total) * 10000) / 100 : null,
        families,
        flags: total > 0 ? flags(families, rollup(prev), p.start) : [],
        note: total === 0 ? 'No edge visits recorded for this day (edge capture may be off).' : null,
        robots_note: 'fetched_robots_txt = the family requested /robots.txt that Hong Kong day. robots.txt currently has no Disallow rules, so obeying a rule cannot be measured yet.',
      },
    };
  },
};
