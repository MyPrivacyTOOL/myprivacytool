// Supabase -> Notion mirror for the Cairn blackboard (MPC-8413 step 3). Runs inside the bridge Worker (no cron: the Cloudflare account
// is at the 5-cron Free-plan limit) after each write, and through two manual endpoints. Notion is a READ-ONLY copy: Supabase is the source
// of truth and a row edited in Notion is overwritten on the next sync (the Verified? checkbox on facts is the exception: never touched).
//
// Privacy: the seed email is masked (j***@example.com) and never sent to Notion. Fact values are copied exactly as stored, so hashed
// values stay hashed. Notion has no retention of its own, so reconcile() archives the Notion rows of any session Supabase has purged
// (72 h). Archived pages stay in Notion's trash for 30 days; empty the trash to remove them sooner.
const NOTION_VERSION = '2022-06-28';
const MAX_WRITES = 35; // Notion writes per call; Workers allow 50 subrequests per invocation on the Free plan (3 Supabase reads + queries + writes)
const MAX_TEXT = 1900; // Notion rich text segments hold 2000 characters
const SOFT_LOCK_MS = 3000;

export const notionConfigured = (env) => Boolean(env.NOTION_TOKEN && env.NOTION_CAIRN_SESSIONS_DB && env.NOTION_CAIRN_FACTS_DB && env.NOTION_CAIRN_INTENTS_DB);

async function notion(env, path, method, body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`notion ${method} ${path.replace(/[0-9a-f-]{32,36}/g, '<id>')} failed: HTTP ${res.status}`);
  return res.json();
}

async function queryAll(env, dbId, filter, maxPages = 5) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const r = await notion(env, `databases/${dbId}/query`, 'POST', { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...r.results);
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  return out;
}

const clip = (s, n = MAX_TEXT) => String(s ?? '').slice(0, n);
const P = {
  title: (v) => ({ title: [{ text: { content: clip(v) } }] }),
  text: (v) => ({ rich_text: v === null || v === undefined || v === '' ? [] : [{ text: { content: clip(v) } }] }),
  num: (v) => ({ number: typeof v === 'number' && Number.isFinite(v) ? v : null }),
  sel: (v) => ({ select: v ? { name: clip(v, 100) } : null }),
  date: (v) => ({ date: v ? { start: v } : null }),
  chk: (v) => ({ checkbox: Boolean(v) }),
  url: (v) => ({ url: v || null }),
  rel: (id) => ({ relation: [{ id }] }),
};
const plain = (prop) => (prop?.rich_text ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
const titleOf = (page, name) => (page.properties?.[name]?.title ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

const HIGH = new Set(['breach_record', 'public_record', 'phone']);
const MEDIUM = new Set(['email', 'social_profile']);
export function riskLevel(fact) {
  const declared = fact.extracted_metadata?.risk_level;
  if (typeof declared === 'string' && ['high', 'medium', 'low'].includes(declared.toLowerCase())) return declared[0].toUpperCase() + declared.slice(1).toLowerCase();
  if (HIGH.has(fact.fact_type)) return 'High';
  if (MEDIUM.has(fact.fact_type)) return 'Medium';
  return 'Low';
}

function sessionProps(s, facts, intents, now) {
  const m = s.metadata ?? {};
  const avg = facts.length ? Math.round((facts.reduce((a, f) => a + Number(f.confidence_score), 0) / facts.length) * 100) : null;
  const usage = [m.cpu_peak_percent !== undefined && `CPU ${m.cpu_peak_percent}%`, m.memory_peak_mb !== undefined && `Mem ${m.memory_peak_mb}MB`].filter(Boolean).join(', ');
  return {
    'Session ID': P.title(s.session_id),
    'Seed (masked)': P.text(maskEmail(s.seed_email)),
    Status: P.sel(s.status),
    'Facts Discovered': P.num(Math.max(s.facts_discovered ?? 0, facts.length)),
    'Intents Generated': P.num(Math.max(s.intents_generated ?? 0, intents.length)),
    'Intents Completed': P.num(s.intents_completed),
    'Blocked Intents': P.num(intents.filter((i) => i.status === 'blocked').length),
    'Confidence (avg)': P.num(avg),
    Created: P.date(s.created_at),
    Started: P.date(s.started_at),
    Concluded: P.date(s.concluded_at),
    'Execution Time (s)': P.num(typeof m.execution_time_seconds === 'number' ? m.execution_time_seconds : null),
    'Resource Usage': P.text(usage),
    'Retain until': P.date(s.retain_until),
    'Last synced': P.date(now.toISOString()),
  };
}

const factProps = (f, sessionPage, retainUntil) => ({
  'Fact ID': P.title(f.fact_id),
  Session: P.rel(sessionPage),
  Description: P.text(f.description),
  Type: P.sel(f.fact_type),
  Value: P.text(f.fact_value),
  Hashed: P.chk(f.is_hashed),
  Confidence: P.num(Math.round(Number(f.confidence_score) * 100)),
  Source: P.text(f.source_name),
  'Source URL': P.url(f.source_url),
  'Extracted Metadata': P.text(JSON.stringify(f.extracted_metadata ?? {})),
  'Discovery Chain': P.text((f.discovery_chain ?? []).join(' > ')),
  'Discovered From Intent': P.text(f.discovered_from_intent_id),
  'Risk Level': P.sel(riskLevel(f)),
  Created: P.date(f.created_at),
  'Retain until': P.date(retainUntil),
});

const intentProps = (i, sessionPage, retainUntil) => ({
  'Intent ID': P.title(i.intent_id),
  Session: P.rel(sessionPage),
  Description: P.text(i.description),
  Type: P.sel(i.intent_type),
  Status: P.sel(i.status),
  'Triggered By Facts': P.text((i.from_fact_ids ?? []).join(', ')),
  'Assigned Worker': P.text(i.worker_assigned),
  Creator: P.text(i.creator),
  'Timeout (s)': P.num(i.timeout_seconds),
  'Result Summary': P.text(i.result_summary ?? i.error_message),
  'Human Hint': P.text(i.human_hint),
  'Execution Time (ms)': P.num(i.execution_metadata?.execution_time_ms),
  Retries: P.num(i.retry_count),
  Created: P.date(i.created_at),
  'Retain until': P.date(retainUntil),
});

// What we compare to decide whether a Notion intent row is stale.
const intentSig = (i) => [i.status, i.retry_count ?? 0, clip(i.result_summary ?? i.error_message ?? ''), clip(i.worker_assigned ?? ''), clip(i.human_hint ?? '')].join('|');
const pageIntentSig = (page) => {
  const p = page.properties ?? {};
  return [p.Status?.select?.name, p.Retries?.number ?? 0, plain(p['Result Summary']), plain(p['Assigned Worker']), plain(p['Human Hint'])].join('|');
};

// Index Notion pages by their title (the Supabase id); anything seen twice is a duplicate to archive.
function indexByTitle(pages, titleProp) {
  const byId = new Map();
  const duplicates = [];
  for (const p of pages) {
    const id = titleOf(p, titleProp);
    if (byId.has(id)) duplicates.push(p.id); else byId.set(id, p);
  }
  return { byId, duplicates };
}

export async function syncSession(env, sb, sessionId, now = new Date()) {
  const sessions = await (await sb(env, `cairn_sessions?select=*&session_id=eq.${encodeURIComponent(sessionId)}`)).json();
  const s = sessions[0];
  if (!s) return { synced: false, reason: 'session_not_found' };
  const [facts, intents] = await Promise.all([
    sb(env, `cairn_facts?select=*&session_id=eq.${s.id}&order=id.asc&limit=1000`).then((r) => r.json()),
    sb(env, `cairn_intents?select=*&session_id=eq.${s.id}&order=id.asc&limit=1000`).then((r) => r.json()),
  ]);

  // Session row (find by title, then create or update).
  const found = (await notion(env, `databases/${env.NOTION_CAIRN_SESSIONS_DB}/query`, 'POST', { filter: { property: 'Session ID', title: { equals: sessionId } }, page_size: 1 })).results[0];
  // Soft lock: if another sync touched this session a moment ago, skip. The next write or a manual sync catches up.
  const last = found?.properties?.['Last synced']?.date?.start;
  const lockMs = Number.isFinite(Number(env.NOTION_SYNC_LOCK_MS)) && env.NOTION_SYNC_LOCK_MS !== undefined ? Number(env.NOTION_SYNC_LOCK_MS) : SOFT_LOCK_MS;
  if (last && now.getTime() - Date.parse(last) < lockMs) return { synced: false, reason: 'recently_synced' };
  const props = sessionProps(s, facts, intents, now);
  const sessionPage = found
    ? (await notion(env, `pages/${found.id}`, 'PATCH', { properties: props })).id
    : (await notion(env, 'pages', 'POST', { parent: { database_id: env.NOTION_CAIRN_SESSIONS_DB }, properties: props })).id;

  let writes = 1;
  const out = { synced: true, facts_created: 0, intents_created: 0, intents_updated: 0, duplicates_archived: 0, remaining: 0 };
  const budget = () => writes < MAX_WRITES;

  const factIndex = indexByTitle(await queryAll(env, env.NOTION_CAIRN_FACTS_DB, { property: 'Session', relation: { contains: sessionPage } }), 'Fact ID');
  const intentIndex = indexByTitle(await queryAll(env, env.NOTION_CAIRN_INTENTS_DB, { property: 'Session', relation: { contains: sessionPage } }), 'Intent ID');

  for (const id of [...factIndex.duplicates, ...intentIndex.duplicates]) {
    if (!budget()) break;
    await notion(env, `pages/${id}`, 'PATCH', { archived: true });
    writes++; out.duplicates_archived++;
  }
  // Facts never change in Supabase, so existing Notion rows are left alone (this also keeps a human's Verified? tick).
  for (const f of facts) {
    if (factIndex.byId.has(f.fact_id)) continue;
    if (!budget()) { out.remaining++; continue; }
    await notion(env, 'pages', 'POST', { parent: { database_id: env.NOTION_CAIRN_FACTS_DB }, properties: factProps(f, sessionPage, s.retain_until) });
    writes++; out.facts_created++;
  }
  for (const i of intents) {
    const page = intentIndex.byId.get(i.intent_id);
    if (!page) {
      if (!budget()) { out.remaining++; continue; }
      await notion(env, 'pages', 'POST', { parent: { database_id: env.NOTION_CAIRN_INTENTS_DB }, properties: intentProps(i, sessionPage, s.retain_until) });
      writes++; out.intents_created++;
    } else if (pageIntentSig(page) !== intentSig(i)) {
      if (!budget()) { out.remaining++; continue; }
      await notion(env, `pages/${page.id}`, 'PATCH', { properties: intentProps(i, sessionPage, s.retain_until) });
      writes++; out.intents_updated++;
    }
  }
  return out;
}

// Archives the Notion rows (session, facts, intents) of every session that no longer exists in Supabase.
// A big session is archived in chunks over several calls: its facts and intents go first, and the session row only once nothing is left under
// it, so the session row doubles as the "still to do" marker and an interrupted run simply continues next time. The defaults suit the Worker
// (a small budget, because a Worker invocation allows 50 subrequests); the scheduled job passes bigger numbers.
const RECONCILE_WRITES = 12;
const RECONCILE_SESSIONS = 3;
export async function reconcile(env, sb, { maxWrites = RECONCILE_WRITES, maxSessions = RECONCILE_SESSIONS } = {}) {
  const pages = await queryAll(env, env.NOTION_CAIRN_SESSIONS_DB, { property: 'Session ID', title: { is_not_empty: true } }, 3);
  // Only rows whose title is a real session id are ever archived: a note someone typed into the database is left alone.
  const bySession = new Map(pages.map((p) => [titleOf(p, 'Session ID'), p.id]).filter(([id]) => /^mpt-cairn-[0-9]{10,}$/.test(id)));
  const out = { checked: bySession.size, sessions_archived: 0, rows_archived: 0, remaining: 0 };
  if (!bySession.size) return out;
  const ids = [...bySession.keys()];
  const live = await (await sb(env, `cairn_sessions?select=session_id&session_id=in.(${ids.join(',')})`)).json();
  const liveIds = new Set(live.map((r) => r.session_id));
  let writes = 0;
  let sessions = 0;
  for (const [sessionId, pageId] of bySession) {
    if (liveIds.has(sessionId)) continue;
    if (writes >= maxWrites || sessions >= maxSessions) { out.remaining++; continue; }
    sessions++;
    const children = [
      ...(await queryAll(env, env.NOTION_CAIRN_FACTS_DB, { property: 'Session', relation: { contains: pageId } })),
      ...(await queryAll(env, env.NOTION_CAIRN_INTENTS_DB, { property: 'Session', relation: { contains: pageId } })),
    ];
    let archivedHere = 0;
    for (const c of children) {
      if (writes >= maxWrites) break;
      await notion(env, `pages/${c.id}`, 'PATCH', { archived: true });
      writes++; archivedHere++; out.rows_archived++;
    }
    if (archivedHere < children.length || writes >= maxWrites) { out.remaining++; continue; } // not finished: the session row stays until next time
    await notion(env, `pages/${pageId}`, 'PATCH', { archived: true });
    writes++; out.sessions_archived++;
  }
  return out;
}
