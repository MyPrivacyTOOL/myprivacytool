// MPC-11307: recount the "Overlap Channels" column of the Notion Hexagon Registry.
//
// Overlap Channels = how many DIFFERENT channels carry the same Evidence Key (the row itself counted). Overlap is wanted, never a duplicate:
// the same data point on several channels raises confidence. This script only counts; it never merges, skips or deletes anything.
//
// It reads a JSON export of the registry rows (a Notion rows-mode result file `{results:[...]}` or a plain array) and prints the writes needed to
// bring the column up to date. It does not call Notion: a person or a Claude session applies the printed changes with notion-update-page.
//
// Usage: node scripts/recount-registry-overlap.mjs rows.json [rows2.json ...] [--catalogue shared/hexagon-registry/hexagons-366.json] [--json]
//
// A row's channel is the catalogue channel of its Catalogue Code when it has one (the registry Channel column is unreliable: many rows sit under
// "Cross-Channel / General"), otherwise the registry Channel value.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Notion rows mode returns markdown-escaped text: "breach\_data\_classes", "[wa.ad](http://wa.ad)\_referral". Undo that.
export function clean(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\/g, '')
    .trim();
}

export function pageIdOf(row) {
  const url = row.url || row.id || '';
  const m = String(url).match(/([0-9a-f]{32})(?:\?|$)/i) || String(url).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].replace(/-/g, '') : null;
}

export function channelOf(row, channelByCode) {
  const code = clean(row['Catalogue Code']);
  if (code && channelByCode.has(code)) return `catalogue:${channelByCode.get(code)}`;
  const registry = clean(row.Channel);
  return registry ? `registry:${registry}` : '';
}

// rows -> { counts: Map(evidenceKey -> distinct channel count), changes: [{ page_id, hexagon_id, evidence_key, from, to }], summary }
export function recount(rows, channelByCode = new Map()) {
  const channelsByKey = new Map();
  const keyed = [];
  for (const row of rows) {
    const key = clean(row['Evidence Key']);
    if (!key) continue;
    const channel = channelOf(row, channelByCode);
    if (!channel) continue;
    if (!channelsByKey.has(key)) channelsByKey.set(key, new Set());
    channelsByKey.get(key).add(channel);
    keyed.push({ row, key });
  }
  const counts = new Map([...channelsByKey].map(([k, set]) => [k, set.size]));
  const changes = [];
  const seen = new Set();
  for (const { row, key } of keyed) {
    const n = counts.get(key);
    const to = n >= 2 ? n : null; // a fact seen on one channel carries no overlap: leave the column empty
    const raw = row['Overlap Channels'];
    const from = raw == null || raw === '' ? null : Number(raw);
    seen.add(row);
    if (from !== to) changes.push({ page_id: pageIdOf(row), hexagon_id: row['Hexagon ID'] ?? null, evidence_key: key, from, to });
  }
  // rows that lost their Evidence Key but still carry a count
  for (const row of rows) {
    if (seen.has(row)) continue;
    const raw = row['Overlap Channels'];
    if (raw != null && raw !== '') changes.push({ page_id: pageIdOf(row), hexagon_id: row['Hexagon ID'] ?? null, evidence_key: clean(row['Evidence Key']), from: Number(raw), to: null });
  }
  const multi = [...counts].filter(([, n]) => n >= 2);
  return {
    counts,
    changes,
    summary: { rows: rows.length, keyed: keyed.length, keys: counts.size, keys_on_2_plus_channels: multi.length, rows_to_write: changes.length },
  };
}

export function loadRows(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(data) ? data : data.results || [];
}

export function loadChannelByCode(file) {
  const items = JSON.parse(readFileSync(file, 'utf8')).items;
  return new Map(items.map((i) => [i.id, i.channel]));
}

function main(argv) {
  const files = [];
  let catalogue = path.join(ROOT, 'shared/hexagon-registry/hexagons-366.json');
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--catalogue') catalogue = path.resolve(argv[++i]);
    else if (argv[i] === '--json') asJson = true;
    else files.push(argv[i]);
  }
  if (!files.length) {
    console.error('Usage: node scripts/recount-registry-overlap.mjs rows.json [rows2.json ...] [--catalogue file] [--json]');
    process.exit(2);
  }
  const rows = files.flatMap(loadRows);
  const { counts, changes, summary } = recount(rows, loadChannelByCode(catalogue));
  if (asJson) {
    console.log(JSON.stringify({ summary, changes }, null, 1));
    return;
  }
  console.log(`rows ${summary.rows}, with Evidence Key ${summary.keyed}, keys ${summary.keys}, keys on 2+ channels ${summary.keys_on_2_plus_channels}`);
  console.log(`rows to write: ${summary.rows_to_write}`);
  for (const c of changes) console.log(`${c.page_id}  hex ${c.hexagon_id}  ${c.evidence_key}  ${c.from ?? 'empty'} -> ${c.to ?? 'empty'}`);
  const top = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('top keys: ' + top.map(([k, n]) => `${k} (${n})`).join(', '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
