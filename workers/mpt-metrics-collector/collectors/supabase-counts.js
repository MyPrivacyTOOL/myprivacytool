// Daily row counts of the Supabase product tables. Counts only: no row data, so no personal data is copied.
export const TABLES = ['scans', 'users', 'leads', 'subscribers', 'mpt_user_engagement', 'interaction_log'];

async function countRows(env, table) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = /\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1];
  if (total === undefined) throw new Error('no content-range');
  return Number(total);
}

export default {
  source: 'supabase',
  report: 'table_counts',
  async collect(env) {
    const counts = {};
    const failures = [];
    for (const t of TABLES) {
      try { counts[t] = await countRows(env, t); } catch (e) { counts[t] = null; failures.push(`${t}: ${e.message}`); }
    }
    return { payload: { counts }, error: failures.length ? failures.join('; ') : null };
  },
};
