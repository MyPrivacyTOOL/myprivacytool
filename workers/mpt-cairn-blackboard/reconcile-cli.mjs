// Scheduled Notion retention sweep for the Cairn blackboard (MPC-8413).
// Supabase deletes a Cairn session 72 hours after it starts (pg_cron job mpt-purge-expired-cairn-sessions, hourly). Notion has no retention of its
// own, so this archives the Notion session, fact and intent rows of every session Supabase no longer has. It runs from GitHub Actions on a schedule
// (.github/workflows/reconcile-mpt-cairn-notion.yml) because the Cloudflare account is at its cron-trigger limit, and it calls the same reconcile()
// the Worker exposes at POST /api/cairn/notion/reconcile, but directly, so it needs no bridge token.
// Safe by design: it only touches rows whose title is a real session id, only archives (Notion keeps archived pages in trash for 30 days), and
// archives nothing if Supabase cannot be read. It prints counts only, never a value.
//   NOTION_TOKEN, NOTION_CAIRN_{SESSIONS,FACTS,INTENTS}_DB, SUPABASE_URL, SUPABASE_KEY
import { reconcile, notionConfigured } from './notion-sync.js';

async function sb(env, path, { method = 'GET' } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { method, headers: { apikey: env.SUPABASE_KEY, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} -> HTTP ${res.status}`);
  return res;
}

// Runs reconcile until nothing is left or a round makes no progress. A session bigger than one round's budget takes several rounds.
export async function run(env, { maxRounds = 12, maxWrites = 150, maxSessions = 50 } = {}) {
  if (!notionConfigured(env)) throw new Error('NOTION_TOKEN and the three NOTION_CAIRN_*_DB variables must be set');
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
  const total = { rounds: 0, checked: 0, sessions_archived: 0, rows_archived: 0, remaining: 0 };
  for (let i = 0; i < maxRounds; i++) {
    const r = await reconcile(env, sb, { maxWrites, maxSessions });
    total.rounds++; total.checked = r.checked; total.sessions_archived += r.sessions_archived; total.rows_archived += r.rows_archived; total.remaining = r.remaining;
    if (!r.remaining) break;
    if (r.rows_archived === 0 && r.sessions_archived === 0) break; // no progress: stop instead of looping
  }
  return total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is not set`); process.exit(2); } return v; };
  const env = {
    NOTION_TOKEN: need('NOTION_TOKEN'),
    NOTION_CAIRN_SESSIONS_DB: need('NOTION_CAIRN_SESSIONS_DB'),
    NOTION_CAIRN_FACTS_DB: need('NOTION_CAIRN_FACTS_DB'),
    NOTION_CAIRN_INTENTS_DB: need('NOTION_CAIRN_INTENTS_DB'),
    SUPABASE_URL: need('SUPABASE_URL').replace(/\/$/, ''),
    SUPABASE_KEY: need('SUPABASE_KEY'),
  };
  try {
    const t = await run(env);
    console.log(`reconcile: checked ${t.checked} Notion session row(s); archived ${t.sessions_archived} session(s) and ${t.rows_archived} row(s) in ${t.rounds} round(s); ${t.remaining} left`);
    if (t.remaining) { console.error('::error::some purged sessions could not be fully archived this run; the next run continues'); process.exit(1); }
  } catch (e) {
    console.error(`::error::reconcile failed: ${e.message}`);
    process.exit(1);
  }
}
