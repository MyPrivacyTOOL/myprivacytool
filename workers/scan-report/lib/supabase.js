// Minimal PostgREST client using the service_role key (tables have forced RLS and no policies).
const DEFAULT_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';

export function db(env, fetchImpl = fetch) {
  const base = `${env.SUPABASE_URL || DEFAULT_URL}/rest/v1`;
  const headers = (extra = {}) => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  });
  async function call(method, path, body, prefer) {
    const res = await fetchImpl(`${base}/${path}`, {
      method, headers: headers(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`supabase ${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
    return text ? JSON.parse(text) : null;
  }
  return {
    select: (path) => call('GET', path),
    insert: (table, row) => call('POST', table, row, 'return=representation').then((r) => (Array.isArray(r) ? r[0] : r)),
    insertMany: (table, rows) => (rows.length ? call('POST', table, rows, 'return=representation') : Promise.resolve([])),
    patch: (path, row) => call('PATCH', path, row, 'return=representation'),
    rpc: (fn, args) => call('POST', `rpc/${fn}`, args),
  };
}
