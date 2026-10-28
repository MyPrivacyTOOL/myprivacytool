import { excludeTestFilter, onlyTestFilter } from '../../../shared/test-records.js';
// Daily row counts of the Supabase product tables. Counts only: no row data, so no personal data is copied.
export const TABLES = ['scans', 'users', 'leads', 'subscribers', 'mpt_user_engagement', 'interaction_log'];
// MPC-7557: test records (the owner's test mailbox and its plus-aliases) never count in KPIs. `counts` excludes them; `test_counts` says how many exist, so the
// difference is visible. Tables with no address column have no test rows to separate.
export const ADDRESS_COLUMN = { scans: 'email_scanned', users: 'email', leads: 'email', subscribers: 'email' };

async function countRows(env, table, filter = '') {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*${filter ? '&' + filter : ''}`, {
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
    const counts = {}; const test_counts = {};
    const failures = [];
    for (const t of TABLES) {
      const col = ADDRESS_COLUMN[t];
      try { counts[t] = await countRows(env, t, col ? excludeTestFilter(col) : ''); } catch (e) { counts[t] = null; failures.push(`${t}: ${e.message}`); }
      if (col) { try { test_counts[t] = await countRows(env, t, onlyTestFilter(col)); } catch { test_counts[t] = null; } }
    }
    return { payload: { counts, test_counts, excludes_test_records: true }, error: failures.length ? failures.join('; ') : null };
  },
};
