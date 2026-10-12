// Machine mirror Notion page (MPC-7492): one child page per Hong Kong day under the Inbound Funnels strategy page, written from the
// stored source=edge / report=machine_daily row (never from raw visits). Bot and AI families only; no person or unknown rows, no IPs.
// Idempotent: a re-run for the same day replaces that page's content. Pages without MARKER are never touched.
import { notion } from './notion.js';
import { hkDayStartOf } from '../lib/hk.js';

export const STRATEGY_PAGE_ID = '3f628547-eaa7-8140-82b4-fc9cd266ae1f'; // MPT > Inbound Funnels (the Mirror) strategy page
export const MIRROR_MARKER = '[mpt-metrics-collector machine mirror]';
export const pageTitle = (day) => `Machine mirror — ${day}`;

const t = (s) => [{ type: 'text', text: { content: String(s).slice(0, 1900) } }];
const para = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: t(s) } });
const head = (s) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: t(s) } });
const bullet = (s) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: t(s) } });
const hkt = (isoStr) => (isoStr ? new Date(new Date(isoStr).getTime() + 8 * 3600000).toISOString().slice(11, 16) : '');
const cell = (s) => [{ type: 'text', text: { content: String(s ?? '') } }];
const row = (cells) => ({ object: 'block', type: 'table_row', table_row: { cells: cells.map(cell) } });

const FLAG_TEXT = {
  new_family: (f) => `NEW: ${f.family} (${f.class}) was never seen before today. ${f.requests} requests.`,
  tenfold_up: (f) => `UP 10x or more: ${f.family} (${f.class}) went from ${f.previous} to ${f.requests} requests day on day.`,
  tenfold_down: (f) => `DOWN 10x or more: ${f.family} (${f.class}) went from ${f.previous} to ${f.requests} requests day on day.`,
};

// Blocks for one day's page. `p` is the stored payload. Only families of class bot or ai are ever written.
export function buildBlocks(day, p, readAt) {
  const fams = (p.families ?? []).filter((f) => f.class === 'bot' || f.class === 'ai');
  const blocks = [
    para(`${MIRROR_MARKER} ${day} (Hong Kong day, 00:00-24:00 HKT). Bot and AI visits only, from the edge record (Supabase edge_visits, read through mpt_machine_visits_daily). Stored in mpt_raw_metrics as source=edge, report=machine_daily. Read ${readAt}. Task MPC-7492.`),
    para(`All traffic recorded at the edge: ${p.total_requests}. Bots and AIs: ${p.machine_requests}${p.machine_share_pct === null ? '' : ` (${p.machine_share_pct}%)`}. Person and unknown visits are counted only in the total and are not listed.`),
    head('Flags'),
    ...((p.flags ?? []).length ? p.flags.map((f) => bullet(FLAG_TEXT[f.flag]?.(f) ?? `${f.flag}: ${f.family}`)) : [bullet('No new families and no tenfold change today.')]),
    head('Who read MyPrivacyTOOL'),
  ];
  if (!fams.length) blocks.push(para('No bot or AI visits today.'));
  else {
    blocks.push({
      object: 'block', type: 'table',
      table: {
        table_width: 8, has_column_header: true, has_row_header: false,
        children: [
          row(['Family', 'Type', 'Requests', 'Pages taken', 'First seen (HKT)', 'Last seen (HKT)', 'Share of all traffic', 'Fetched robots.txt']),
          ...fams.map((f) => row([f.family, f.class === 'ai' ? 'AI' : 'Bot', f.requests, f.pages_taken, hkt(f.first_seen), hkt(f.last_seen), f.share_pct === null ? '' : `${f.share_pct}%`, f.fetched_robots_txt ? 'yes' : 'no'])),
        ],
      },
    });
    const withPages = fams.filter((f) => f.pages?.length);
    if (withPages.length) {
      blocks.push(head('Pages taken'));
      for (const f of withPages) blocks.push(bullet(`${f.family}: ${f.pages.join(', ')}${f.pages_taken > f.pages.length ? ` (+${f.pages_taken - f.pages.length} more)` : ''}`));
    }
  }
  blocks.push(head('How to read this'), para(p.robots_note ?? ''), para('Family comes from the self-declared user agent, so it can be faked. The classifier rule set decides bot or AI; see docs/edge-capture.md.'));
  return blocks;
}

async function findExisting(env, title) {
  const res = await notion(env, 'POST', '/search', { query: title, filter: { property: 'object', value: 'page' }, page_size: 10 });
  const hits = (res.results ?? []).filter((pg) => {
    const name = (pg.properties?.title?.title ?? []).map((x) => x.plain_text ?? x.text?.content ?? '').join('');
    return name === title && (pg.parent?.page_id ?? '').replace(/-/g, '') === STRATEGY_PAGE_ID.replace(/-/g, '');
  });
  if (hits.length > 1) throw new Error(`${hits.length} pages already titled "${title}"; refusing to pick one`);
  return hits[0] ?? null;
}

async function supaRow(env, day) {
  const from = hkDayStartOf(day).toISOString();
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics?source=eq.edge&report=eq.machine_daily&status=eq.ok&period_start=eq.${encodeURIComponent(from)}&order=captured_at.desc&limit=1&select=payload`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase read machine_daily failed: HTTP ${res.status}`);
  return (await res.json())[0]?.payload ?? null;
}

export async function publishMachineMirror(env, day, now = new Date()) {
  const p = await supaRow(env, day);
  if (!p) return { kind: 'machine_mirror', day, action: 'skipped_no_row' };
  if (!(p.total_requests > 0)) return { kind: 'machine_mirror', day, action: 'skipped_no_data' }; // no real data yet: no empty page
  const title = pageTitle(day);
  const blocks = buildBlocks(day, p, now.toISOString());
  const existing = await findExisting(env, title);
  if (!existing) {
    const created = await notion(env, 'POST', '/pages', { parent: { type: 'page_id', page_id: STRATEGY_PAGE_ID }, properties: { title: { title: t(title) } }, children: blocks });
    return { kind: 'machine_mirror', day, action: 'created', url: created.url };
  }
  const old = await notion(env, 'GET', `/blocks/${existing.id}/children?page_size=100`);
  const first = old.results?.[0]?.paragraph?.rich_text?.map((x) => x.plain_text ?? '').join('') ?? '';
  if (!first.startsWith(MIRROR_MARKER)) return { kind: 'machine_mirror', day, action: 'skipped_not_ours', url: existing.url };
  for (const b of old.results) await notion(env, 'DELETE', `/blocks/${b.id}`);
  await notion(env, 'PATCH', `/blocks/${existing.id}/children`, { children: blocks });
  return { kind: 'machine_mirror', day, action: 'updated', url: existing.url };
}


