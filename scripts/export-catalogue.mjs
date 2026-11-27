// MPC-11541: the full footprint. Turns the registry's data-point rows into the /footprint/ slabs and the Supabase seed.
//
//   node scripts/export-catalogue.mjs            # write public/footprint/footprint-datapoints.json (+ .manifest.json) and the seed migration
//   node scripts/export-catalogue.mjs --check    # derive and compare with what is on disk; write nothing (CI)
//   node scripts/export-catalogue.mjs --print-count
//
// Source: shared/hexagon-registry/registry-datapoints.snapshot.json, a read-only copy of the Notion registry (this repo never writes to Notion).
// Publish rule (owner decision, MPC-11541, 2026-11-27): a row is published when its Row Type is empty or "Data point" AND its Decision is not "Dropped".
// Placeholder, Control, Framework and Feature rows are never published. The count is DERIVED from that rule, never typed into the data;
// EXPECTED_COUNT below is only the number the task expects today. If the derived count differs the export stops and says so. It does not force it.
//
// Badges: "planned" by default. "live" = the row is one of the scored items (54 web, 26 Telegram, 7 email, 10 X), taken from the code, never listed by hand.
// "in_build" = built in the code but not scored (the flag-off "extras", EXTRA_HEXAGON_IDS). Nothing here changes scanCounts, the web 54 or exposure-v1.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_FILE = path.join(ROOT, 'shared/hexagon-registry/registry-datapoints.snapshot.json');
export const OUT_JSON = path.join(ROOT, 'public/footprint/footprint-datapoints.json');
export const OUT_MANIFEST = path.join(ROOT, 'public/footprint/footprint-datapoints.manifest.json');
export const OUT_MIGRATION = path.join(ROOT, 'supabase/migrations/20261127080000_mpc_11541_footprint_datapoints.sql');

/** What MPC-11541 expects the derived count to be today (662 rows - 7 non-data - 5 Dropped). Not used to build anything; only to fail loudly on a surprise. */
export const EXPECTED_COUNT = 650;
export const BADGES = ['planned', 'in_build', 'live'];
const NOT_CHECKED = 'Not checked by MPT yet.';
const IN_BUILD_NOTE = 'In build. Not part of your score yet.';

/** Notion exports text with markdown escapes and auto-links (web.postal\_area, [web.network](http://web.network)\_distance). Give back the plain text. */
export function cleanText(s) {
  return String(s ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\\([!-/:-@[-`{-~])/g, '$1').trim();
}

/** The one publish rule. Row Type empty or "Data point", and Decision not "Dropped". */
export function isPublishable(row) {
  const type = cleanText(row.row_type);
  const decision = cleanText(row.decision);
  return (type === '' || type === 'Data point') && decision !== 'Dropped';
}

const RISK = { critical: 'high', high: 'high', medium: 'medium', low: 'low' };
export const riskTier = (r) => RISK[cleanText(r).toLowerCase()] ?? 'medium';
export const arrivalClass = (a) => (/^Class ([ABCD])\b/.exec(cleanText(a)) ?? [])[1] ?? '';

// Display names for channel keys the code catalogue does not know yet. Keys, not ids: no hexagon is listed here.
const EXTRA_CHANNEL_LABELS = { bluesky: 'Bluesky', mastodon: 'Mastodon', slack: 'Slack', twitch: 'Twitch', snapchat: 'Snapchat', 'imessage-rcs': 'iMessage and RCS' };
const shortLabel = (s) => cleanText(s).replace(/\s*\(.*\)$/, '');

/** The set of ids that are scored today, read from the code. { web, telegram, email, x } -> arrays of catalogue ids. */
export async function loadScoredSets() {
  const reg = await import('../shared/hexagon-registry/registry.js');
  const ch = await import('../shared/hexagon-registry/channels.js');
  const cat = await import('../shared/hexagon-registry/catalogue.js');
  return {
    sets: {
      web: reg.HEXAGONS.map((h) => h.id),
      telegram: ch.TELEGRAM_HEXAGONS.filter((h) => h.enabled).map((h) => h.id),
      email: reg.EMAIL_HEXAGONS.map((h) => h.id),
      x: cat.HEXAGON_CATALOGUE.filter((h) => h.channel === 'x' && h.status === 'defined').map((h) => h.id),
    },
    // built in the code but not scored (the flag-off "extras"). A disabled item (no share button built, not part of the baseline) is not built, so it stays planned.
    built: [...ch.EXTRA_HEXAGON_IDS],
    channelLabels: Object.fromEntries(cat.CATALOGUE_CHANNELS.map((c) => [c.key, shortLabel(c.label)])),
    slugs: Object.fromEntries(cat.HEXAGON_CATALOGUE.map((h) => [h.id, h.slug])),
  };
}

/** Badge for one catalogue code. live beats in_build beats planned. */
export function deriveBadge(code, scored) {
  if (!code) return 'planned';
  if (scored.liveIds.has(code)) return 'live';
  if (scored.builtIds.has(code)) return 'in_build';
  return 'planned';
}

export function channelName(row, channelLabels) {
  const key = cleanText(row.channel_key);
  if (key === 'web') return 'Web'; // the built-in 54 tiles on /footprint/ are 'Web'; one name, or the channel splits in two
  if (key) return channelLabels[key] ?? EXTRA_CHANNEL_LABELS[key] ?? key;
  return shortLabel(row.channel) || 'Cross-channel';
}

/**
 * Derive the published slabs. Pure: rows in, slabs out.
 * @param {object[]} rows registry rows (any Row Type, any Decision)
 * @param {{sets: Record<string,string[]>, built: string[], channelLabels: Record<string,string>, slugs: Record<string,string>}} code the scored sets etc. from loadScoredSets()
 */
export function deriveCatalogue(rows, code) {
  const scored = { liveIds: new Set(Object.values(code.sets).flat()), builtIds: new Set(code.built) };
  const publishable = rows.filter(isPublishable);
  const ids = publishable.map((r) => r.hexagon_id);
  if (new Set(ids).size !== ids.length) throw new Error('registry rows with the same Hexagon ID among the publishable rows');
  const codeCount = new Map();
  for (const r of publishable) { const c = cleanText(r.catalogue_code); if (c) codeCount.set(c, (codeCount.get(c) ?? 0) + 1); }
  const slabs = publishable.map((r) => {
    const catCode = cleanText(r.catalogue_code);
    const badge = deriveBadge(catCode, scored);
    const channel = channelName(r, code.channelLabels);
    const slab = {
      // the catalogue code is the id when it is unique, so the 54 web items still merge into the built-in tiles; otherwise the registry row number
      id: catCode && codeCount.get(catCode) === 1 ? catCode : `hx-${r.hexagon_id}`,
      hexagon_id: r.hexagon_id,
      label: cleanText(r.footprint),
      group: channel, box: channel, channel,
      channel_key: cleanText(r.channel_key),
      sens: riskTier(r.risk),
      cap: cleanText(r.reveals),
      val: badge === 'planned' ? NOT_CHECKED : badge === 'in_build' ? IN_BUILD_NOTE : '',
      arrival: arrivalClass(r.arrival),
      badge,
    };
    if (catCode) slab.code = catCode;
    if (code.slugs[catCode]) slab.slug = code.slugs[catCode];
    return slab;
  });
  // every scored item must be found exactly once, or a "live" badge is missing or doubled
  const liveCodes = Object.values(code.sets).flat();
  const missing = liveCodes.filter((c) => slabs.filter((s) => s.code === c).length !== 1);
  if (missing.length) throw new Error(`scored items not found exactly once among the published rows: ${missing.join(', ')}`);
  const counts = { planned: 0, in_build: 0, live: 0 };
  for (const s of slabs) counts[s.badge]++;
  const sets = Object.fromEntries(Object.entries(code.sets).map(([k, v]) => [k, v.length]));
  return { slabs, count: slabs.length, badges: counts, scored: sets };
}

const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

/** The seed migration, generated from the slabs. Reference data only; touches no other table. */
export function renderMigration(slabs) {
  const n = slabs.length;
  const vals = slabs.map((s) => `(${[s.hexagon_id, q(s.id), q(s.code ?? ''), q(s.channel_key), q(s.channel), q(s.label), q(s.sens), q(s.arrival), q(s.badge), q(s.cap), q(s.slug ?? '')].join(', ')})`).join(',\n');
  const keep = slabs.map((s) => s.hexagon_id).join(', ');
  return `-- MPC-11541: the full footprint, every published data-point row of the registry, each with a status badge. GENERATED by scripts/export-catalogue.mjs. Do not edit by hand.
-- Read-only reference data for the website. A NEW table: public.hexagon_catalogue (368 rows) is left alone because the data-point ledger (MPC-8737 / MPC-8753) reads it row for row.
-- Rule: Row Type empty or "Data point", and Decision not "Dropped". ${n} rows today (derived, not typed). The last statement fails the migration if the table does not end at exactly that count.
-- Rollback: drop table public.footprint_datapoints;
create table if not exists public.footprint_datapoints (
  hexagon_id integer primary key,            -- the registry row's Hexagon ID
  id text not null unique,                   -- the slab id on /footprint/ (the catalogue code when it is unique, otherwise hx-<hexagon_id>)
  code text not null default '',             -- the catalogue code, when the registry row has one
  channel_key text not null default '',
  channel text not null,
  label text not null,
  risk text not null check (risk in ('high','medium','low')),
  arrival text not null default '' check (arrival in ('','A','B','C','D')),
  badge text not null check (badge in ('planned','in_build','live')),
  reveals text not null default '',
  slug text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists footprint_datapoints_channel_idx on public.footprint_datapoints (channel);
create index if not exists footprint_datapoints_badge_idx on public.footprint_datapoints (badge);

alter table public.footprint_datapoints enable row level security;
drop policy if exists footprint_datapoints_read on public.footprint_datapoints;
create policy footprint_datapoints_read on public.footprint_datapoints for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.footprint_datapoints from anon, authenticated;
grant select on public.footprint_datapoints to anon, authenticated;

insert into public.footprint_datapoints (hexagon_id, id, code, channel_key, channel, label, risk, arrival, badge, reveals, slug) values
${vals}
on conflict (hexagon_id) do update set id = excluded.id, code = excluded.code, channel_key = excluded.channel_key, channel = excluded.channel, label = excluded.label,
  risk = excluded.risk, arrival = excluded.arrival, badge = excluded.badge, reveals = excluded.reveals, slug = excluded.slug, updated_at = now();
-- rows of this table that are no longer published (a row since Dropped or reclassified) go; no other table is touched
delete from public.footprint_datapoints where hexagon_id <> all (array[${keep}]);

do $$
declare n integer;
begin
  select count(*) into n from public.footprint_datapoints;
  if n <> ${n} then raise exception 'MPC-11541: footprint_datapoints has % rows, the export derived ${n}', n; end if;
end $$;
`;
}

export function buildOutputs(derived) {
  const json = JSON.stringify(derived.slabs);
  const manifest = JSON.stringify({ _about: 'MPC-11541. Generated by scripts/export-catalogue.mjs. count is derived from the registry rule, never typed.', rule: 'Row Type empty or "Data point" AND Decision not "Dropped"', count: derived.count, badges: derived.badges, scored: derived.scored }, null, 1) + '\n';
  return { json, manifest, migration: renderMigration(derived.slabs) };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
  const code = await loadScoredSets();
  const derived = deriveCatalogue(snapshot.rows, code);
  if (derived.count !== EXPECTED_COUNT) {
    console.error(`STOP: the registry rule derives ${derived.count} published rows, the task expects ${EXPECTED_COUNT}. Nothing was written. Report the difference; do not force the number.`);
    process.exit(1);
  }
  if (args.has('--print-count')) { console.log(derived.count); return; }
  const out = buildOutputs(derived);
  if (args.has('--check')) {
    const stale = [[OUT_JSON, out.json], [OUT_MANIFEST, out.manifest], [OUT_MIGRATION, out.migration]].filter(([f, c]) => !existsSync(f) || readFileSync(f, 'utf8') !== c).map(([f]) => path.relative(ROOT, f));
    if (stale.length) { console.error(`STOP: generated files are out of date, run node scripts/export-catalogue.mjs: ${stale.join(', ')}`); process.exit(1); }
    console.log(`ok: ${derived.count} published rows; the files on disk match`);
    return;
  }
  writeFileSync(OUT_JSON, out.json);
  writeFileSync(OUT_MANIFEST, out.manifest);
  writeFileSync(OUT_MIGRATION, out.migration);
  console.log(`derived ${derived.count} published rows (rule: Row Type empty or Data point, Decision not Dropped); badges ${JSON.stringify(derived.badges)}; scored ${JSON.stringify(derived.scored)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
