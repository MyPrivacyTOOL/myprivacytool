// MPC-7557: reads the result of the nightly / weekly chain test (scripts/nightly-chain/run.mjs, GitHub Actions) and raises the usual Slack alert, naming the failed step.
// No second alert path: the runner writes one counts-only row per run to mpt_raw_metrics; this daily collector (00:15 HKT, after the 23:30 HKT run) turns it into an alert.
// It also catches a run that never reported: no nightly row in 30 hours means the job, its schedule or its credentials are broken, which a "failed step" alert cannot say.
// Counts and step names only. No email address, scan number or message id.
const HOURS = 3600000;
export const NIGHTLY_MAX_AGE_H = 30;      // nightly runs 23:30 HKT; this collector runs 00:15 HKT the same night
export const WEEKLY_MAX_AGE_H = 9 * 24;   // weekly runs Sunday night; allow a day's slack
export const EXPECTED_FROM = '2026-11-01'; // until then a missing first run is "not started", not an alert (the workflow is merged but its first scheduled run may not have happened)

async function latest(env, report) {
  const url = `${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics?source=eq.nightly_chain&report=eq.${report}&order=captured_at.desc&limit=1&select=captured_at,status,error,payload`;
  const res = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`nightly-chain: read failed: HTTP ${res.status}`);
  return (await res.json())[0] ?? null;
}

export function judge(row, maxAgeH, now, required) {
  if (!row) return { state: required ? 'missed' : 'not_started', age_hours: null };
  const age = Math.round(((now.getTime() - Date.parse(row.captured_at)) / HOURS) * 10) / 10;
  if (age > maxAgeH) return { state: 'missed', age_hours: age, last_ok: row.status === 'ok' };
  if (row.status === 'ok') return { state: 'ok', age_hours: age };
  if (row.payload?.not_configured) return { state: 'not_configured', age_hours: age, detail: String(row.payload.not_configured).slice(0, 120) };
  return { state: 'failed', age_hours: age, failed_step: row.payload?.failed_step ?? 'unknown', day: row.payload?.day ?? null };
}

export default {
  source: 'supabase',
  report: 'nightly_chain_status',
  async collect(env, now = new Date()) {
    const required = now.toISOString().slice(0, 10) >= EXPECTED_FROM;
    const [nightly, weekly] = [judge(await latest(env, 'nightly'), NIGHTLY_MAX_AGE_H, now, required), judge(await latest(env, 'weekly'), WEEKLY_MAX_AGE_H, now, required)];
    return { payload: { nightly, weekly, alert: [nightly, weekly].some((j) => ['failed', 'missed', 'not_configured'].includes(j.state)) } };
  },
  // One message per bad state, naming the step. A check that cannot run is an alert too: a silent check is how MPC-7535 was missed.
  alertText(row) {
    if (row.status === 'error') return `:rotating_light: The nightly chain test status could NOT be read (${row.error || 'unknown error'}). Nobody is watching the scan-to-report chain until this is fixed.`;
    const p = row.payload || {};
    const lines = [];
    for (const [name, j] of [['Nightly', p.nightly], ['Weekly (unsubscribe + delete)', p.weekly]]) {
      if (!j) continue;
      if (j.state === 'failed') lines.push(`${name} chain test FAILED at step "${j.failed_step}"${j.day ? ` on ${j.day}` : ''}.`);
      else if (j.state === 'not_configured') lines.push(`${name} chain test is NOT CONFIGURED (${j.detail || 'missing credentials'}); nothing is being tested.`);
      else if (j.state === 'missed') lines.push(`${name} chain test has not reported for ${j.age_hours === null ? 'its whole history' : `${j.age_hours} hours`}; the job, its schedule or its credentials are broken.`);
    }
    return lines.length ? `:rotating_light: ${lines.join(' ')} Look at the Actions run "Nightly chain test" (MPC-7557). Counts and step names only; no addresses in this message.` : null;
  },
};
