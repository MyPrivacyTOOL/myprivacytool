// MPC-11541: the footprint export. Filter, derived count, badges, and the generated files staying in step with each other.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cleanText, isPublishable, deriveBadge, deriveCatalogue, loadScoredSets, renderMigration, buildOutputs,
  EXPECTED_COUNT, SNAPSHOT_FILE, OUT_JSON, OUT_MANIFEST, OUT_MIGRATION,
} from './export-catalogue.mjs';

const row = (over = {}) => ({ hexagon_id: 1, footprint: 'A thing', channel: 'Web Scan', channel_key: 'web', catalogue_code: '', risk: 'Medium', arrival: 'Class A - First Contact', access: 'OK', build_status: 'New', row_type: null, decision: null, reveals: '', ...over });
const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
const code = await loadScoredSets();

describe('publish filter', () => {
  it('keeps rows whose Row Type is empty or "Data point"', () => {
    expect(isPublishable(row({ row_type: null }))).toBe(true);
    expect(isPublishable(row({ row_type: '' }))).toBe(true);
    expect(isPublishable(row({ row_type: 'Data point' }))).toBe(true);
  });
  it.each(['Placeholder', 'Control', 'Framework', 'Feature'])('excludes a %s row', (type) => {
    expect(isPublishable(row({ row_type: type }))).toBe(false);
  });
  it('excludes any Dropped row, whatever its Row Type, and keeps Held rows', () => {
    expect(isPublishable(row({ decision: 'Dropped' }))).toBe(false);
    expect(isPublishable(row({ row_type: 'Data point', decision: 'Dropped' }))).toBe(false);
    expect(isPublishable(row({ decision: 'Held' }))).toBe(true);
  });
  it('derives the count from the rule, not from a typed number', () => {
    const rows = [row({ hexagon_id: 1 }), row({ hexagon_id: 2, row_type: 'Placeholder' }), row({ hexagon_id: 3, row_type: 'Control' }), row({ hexagon_id: 4, row_type: 'Framework' }),
      row({ hexagon_id: 5, row_type: 'Feature' }), row({ hexagon_id: 6, decision: 'Dropped' }), row({ hexagon_id: 7, row_type: 'Data point' })];
    const d = deriveCatalogue(rows, { ...code, sets: { web: [], telegram: [], email: [], x: [] } });
    expect(d.count).toBe(2);
    expect(d.slabs.map((s) => s.hexagon_id)).toEqual([1, 7]);
  });
  it('refuses two published rows with the same Hexagon ID', () => {
    expect(() => deriveCatalogue([row(), row()], { ...code, sets: { web: [], telegram: [], email: [], x: [] } })).toThrow(/same Hexagon ID/);
  });
  it('the registry snapshot derives exactly the expected count', () => {
    const d = deriveCatalogue(snapshot.rows, code);
    expect(d.count).toBe(EXPECTED_COUNT);
    expect(d.count).toBe(snapshot.rows.filter(isPublishable).length);
  });
  it('no placeholder, control or dropped row reaches the output', () => {
    const d = deriveCatalogue(snapshot.rows, code);
    const published = new Set(d.slabs.map((s) => s.hexagon_id));
    for (const r of snapshot.rows.filter((r) => cleanText(r.decision) === 'Dropped')) expect(published.has(r.hexagon_id)).toBe(false);
    expect(d.slabs.some((s) => /deepseekblack/i.test(`${s.id} ${s.label}`))).toBe(false);
    expect(d.slabs.some((s) => /^(HEX|CTL)-/i.test(s.code ?? ''))).toBe(false);
  });
});

describe('badges', () => {
  const scored = { liveIds: new Set(['a.live']), builtIds: new Set(['a.built', 'a.live']) };
  it('is planned by default, in_build when built but not scored, live when scored', () => {
    expect(deriveBadge('', scored)).toBe('planned');
    expect(deriveBadge('a.unknown', scored)).toBe('planned');
    expect(deriveBadge('a.built', scored)).toBe('in_build');
    expect(deriveBadge('a.live', scored)).toBe('live');
  });
  it('reads the scored sets from the code: 54 web, 26 Telegram, 7 email, 10 X', () => {
    expect(Object.fromEntries(Object.entries(code.sets).map(([k, v]) => [k, v.length]))).toEqual({ web: 54, telegram: 26, email: 7, x: 10 });
  });
  it('every scored item is published exactly once and is live; nothing else is', () => {
    const d = deriveCatalogue(snapshot.rows, code);
    const scoredIds = Object.values(code.sets).flat();
    const live = d.slabs.filter((s) => s.badge === 'live');
    expect(live.map((s) => s.code).sort()).toEqual([...scoredIds].sort());
    expect(d.badges.live).toBe(97);
    expect(d.badges.planned + d.badges.in_build + d.badges.live).toBe(d.count);
  });
  it('a built Telegram item that is switched off in the code is not live', () => {
    const d = deriveCatalogue(snapshot.rows, code);
    for (const id of ['tg.message_counter', 'tg.phone_shared', 'tg.location_shared', 'tg.group_role']) {
      const slab = d.slabs.find((s) => s.code === id);
      if (slab) expect(slab.badge).not.toBe('live');
    }
  });
  it('fails, rather than guesses, when a scored item has no published row', () => {
    const rows = snapshot.rows.filter((r) => cleanText(r.catalogue_code) !== 'location');
    expect(() => deriveCatalogue(rows, code)).toThrow(/location/);
  });
  it('planned slabs say "Not checked by MPT yet", live ones do not', () => {
    const d = deriveCatalogue(snapshot.rows, code);
    expect(d.slabs.filter((s) => s.badge === 'planned').every((s) => /not checked by mpt yet/i.test(s.val))).toBe(true);
    expect(d.slabs.filter((s) => s.badge === 'live').every((s) => s.val === '')).toBe(true);
  });
});

describe('channel names', () => {
  it('web rows are "Web" so they join the built-in web tiles, and the Web channel is one channel', () => {
    const d = deriveCatalogue(snapshot.rows, code);
    expect(new Set(d.slabs.filter((s) => s.channel_key === 'web').map((s) => s.channel))).toEqual(new Set(['Web']));
    expect(d.slabs.some((s) => s.channel === 'Web scan')).toBe(false);
  });
});

describe('cleanText', () => {
  it('undoes Notion escapes and auto-links', () => {
    expect(cleanText('web.postal\\_area')).toBe('web.postal_area');
    expect(cleanText('[web.network](http://web.network)\\_distance')).toBe('web.network_distance');
    expect(cleanText(null)).toBe('');
  });
});

describe('generated files agree with each other and with the derivation', () => {
  const d = deriveCatalogue(snapshot.rows, code);
  const out = buildOutputs(d);
  it('the files on disk are what the export derives now', () => {
    expect(readFileSync(OUT_JSON, 'utf8')).toBe(out.json);
    expect(readFileSync(OUT_MANIFEST, 'utf8')).toBe(out.manifest);
    expect(readFileSync(OUT_MIGRATION, 'utf8')).toBe(out.migration);
  });
  it('JSON length = manifest count = seed rows = the count the migration asserts', () => {
    const json = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
    const manifest = JSON.parse(readFileSync(OUT_MANIFEST, 'utf8'));
    const sql = readFileSync(OUT_MIGRATION, 'utf8');
    const seedRows = (sql.match(/^\(\d+, '/gm) ?? []).length;
    expect(json.length).toBe(manifest.count);
    expect(seedRows).toBe(manifest.count);
    expect(sql).toContain(`if n <> ${manifest.count} then`);
    expect(new Set(json.map((s) => s.id)).size).toBe(json.length);
  });
  it('escapes quotes in the seed', () => {
    const sql = renderMigration([{ hexagon_id: 1, id: "o'x", code: '', channel_key: 'web', channel: 'Web', label: "It's", sens: 'low', arrival: 'A', badge: 'planned', cap: '' }]);
    expect(sql).toContain("'It''s'");
  });
});

describe('/footprint/ copy', () => {
  it('states no total anywhere in the page or the data settings', () => {
    const html = readFileSync(OUT_JSON.replace('footprint-datapoints.json', 'index.html'), 'utf8');
    const manifest = JSON.parse(readFileSync(OUT_MANIFEST, 'utf8'));
    expect(html).not.toMatch(new RegExp(`\\b${manifest.count}\\b`));
    expect(html).not.toMatch(/\b(?:368|366)\b/);
    expect(html).not.toMatch(/\bN\s*\+\s*' data points'/);
  });
});
