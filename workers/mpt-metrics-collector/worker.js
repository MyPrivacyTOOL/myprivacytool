// mpt-metrics-collector (MPC-7377): daily cron pulls raw numbers from each source and appends one row per source
// to public.mpt_raw_metrics (append-only). Collectors are pluggable: add a module to collectors/ and list it below.
// A failing source writes a status=error row and never stops the others. No secret value is ever logged or stored.
import supabaseCounts from './collectors/supabase-counts.js';
import cloudflareZone from './collectors/cloudflare-zone.js';
import cloudflareWorkers from './collectors/cloudflare-workers.js';

export const COLLECTOR_VERSION = '1.1.0';
export const COLLECTORS = [supabaseCounts, cloudflareZone, cloudflareWorkers];

const SAFE = (msg, env) => {
  let s = String(msg ?? '');
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'COLLECTOR_TRIGGER_TOKEN', 'CLOUDFLARE_ANALYTICS_TOKEN']) if (env[k]) s = s.split(env[k]).join('[redacted]');
  return s.slice(0, 500);
};

async function insertRow(env, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${row.source} failed: HTTP ${res.status}`);
}

export async function runAll(env, collectors = COLLECTORS, now = new Date()) {
  const results = [];
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const c of collectors) {
    // A collector may cover another period (Cloudflare pulls the last complete UTC day) via period(now) -> {start, end}.
    const period = c.period?.(now);
    const row = {
      source: c.source, report: c.report, captured_at: now.toISOString(),
      period_start: (period?.start ?? dayStart).toISOString(), period_end: (period?.end ?? now).toISOString(),
      payload: {}, collector_version: COLLECTOR_VERSION, status: 'ok', error: null,
    };
    try {
      const out = await c.collect(env, now);
      row.payload = out.payload ?? {};
      if (out.error) { row.status = 'error'; row.error = SAFE(out.error, env); }
    } catch (e) {
      row.status = 'error'; row.error = SAFE(e?.message, env);
    }
    try { await insertRow(env, row); results.push({ source: c.source, status: row.status, stored: true }); }
    catch (e) { results.push({ source: c.source, status: 'error', stored: false, error: SAFE(e?.message, env) }); }
  }
  return results;
}

const configured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export default {
  async scheduled(_event, env, ctx) {
    if (!configured(env)) { console.error('mpt-metrics-collector: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); return; }
    ctx.waitUntil(runAll(env).then((r) => console.log(JSON.stringify(r))));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, worker: 'mpt-metrics-collector', version: COLLECTOR_VERSION, configured: configured(env) });
    // Manual trigger for verification: POST /run with Authorization: Bearer <COLLECTOR_TRIGGER_TOKEN>.
    if (url.pathname === '/run' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!configured(env)) return json({ error: 'not configured' }, 500);
      return json({ results: await runAll(env) });
    }
    return json({ error: 'not found' }, 404);
  },
};
