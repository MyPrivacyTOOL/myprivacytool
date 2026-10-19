// Static report: the same honeycomb as the dashboard, as one self-contained white HTML page (inline SVG, no scripts).
// Pure functions, so the content is unit-tested. Opens anywhere and prints cleanly to PDF.
import type { Hexagon, ObservationStatus } from '@/types/hexagon';
import { hiveLayout } from '@/lib/honeycomb';
import { groupHexagons } from '@/lib/hexagonGroups';
import { getHexagon } from '../../shared/hexagon-registry/registry.js';

const REPORT_WIDTH = 480;
const POINTS = '50,2 98,28.7 98,86.8 50,113.5 2,86.8 2,28.7';
const WAITING = new Set<ObservationStatus>(['not_checked', 'false_positive']);

interface Paint { fill: string; stroke: string; ink: string; dashed: boolean }
const GREY: Paint = { fill: '#f9fafb', stroke: '#e5e7eb', ink: '#9ca3af', dashed: false };
const PAINT: Record<ObservationStatus, Paint> = {
  checked: { fill: '#f0fdf4', stroke: '#16a34a', ink: '#15803d', dashed: false },
  confirmed: { fill: '#f0fdf4', stroke: '#16a34a', ink: '#15803d', dashed: false },
  given: { fill: '#fffbeb', stroke: '#f59e0b', ink: '#b45309', dashed: true },
  guess: { fill: '#faf5ff', stroke: '#a855f7', ink: '#7e22ce', dashed: false },
  disputed: { fill: '#fff7ed', stroke: '#f97316', ink: '#c2410c', dashed: false },
  not_checked: GREY,
  false_positive: GREY,
};
const EXPOSED: Paint = { fill: '#fef2f2', stroke: '#ef4444', ink: '#b91c1c', dashed: false };

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Greedy wrap into at most two lines, the second shortened with an ellipsis. */
const wrap = (text: string, max: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  const out = lines.slice(0, 2);
  if (lines.length > 2) out[1] = out[1].slice(0, max - 1) + '…';
  return out.map((l) => (l.length > max ? l.slice(0, max - 1) + '…' : l));
};

export const isExposed = (h: Hexagon, fixedIds: ReadonlySet<string>) =>
  h.status === 'confirmed' && h.exposure === true && !fixedIds.has(h.id);

const tileSvg = (h: Hexagon, fixedIds: ReadonlySet<string>, left: number, top: number, hw: number) => {
  const exposed = isExposed(h, fixedIds);
  const p = exposed ? EXPOSED : PAINT[h.status];
  const waiting = WAITING.has(h.status);
  const emoji = waiting ? '🔍' : getHexagon(h.id)?.artwork.emoji ?? '•';
  const label = wrap(h.label.toUpperCase(), 14);
  const value = !waiting && h.data ? wrap(h.data, 16)[0] : '';
  const secured = !exposed && (h.status === 'checked' || h.status === 'confirmed');
  const lines = label.map((l, i) => `<text x="50" y="${64 + i * 8}" font-size="6.5" font-weight="700" letter-spacing=".4" fill="${p.ink}">${escapeHtml(l)}</text>`);
  const vy = 64 + label.length * 8 + 3;
  return `<g transform="translate(${left} ${top}) scale(${hw / 100})">
<polygon points="${POINTS}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="3" stroke-linejoin="round"${p.dashed ? ' stroke-dasharray="7 5"' : ''}/>
<text x="50" y="52" font-size="18">${emoji}</text>${lines.join('')}${value ? `<text x="50" y="${vy}" font-size="7" fill="#111827">${escapeHtml(value)}</text>` : ''}
${secured ? '<circle cx="80" cy="26" r="9" fill="#16a34a"/><text x="80" y="30" font-size="11" fill="#fff">✓</text>' : ''}</g>`;
};

const pillarSvg = (items: Hexagon[], fixedIds: ReadonlySet<string>) => {
  const l = hiveLayout(items.length, REPORT_WIDTH);
  const tiles = items.map((h, i) => tileSvg(h, fixedIds, l.positions[i].left, l.positions[i].top, l.hw)).join('\n');
  return `<svg viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" height="${l.height}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" role="img" aria-label="Hexagons">${tiles}</svg>`;
};

export const countSecuredFor = (hexagons: Hexagon[], fixedIds: ReadonlySet<string>) =>
  hexagons.filter((h) => h.status === 'checked' || (h.status === 'confirmed' && !isExposed(h, fixedIds))).length;

export function buildReportHtml(
  hexagons: Hexagon[],
  opts: { title: string; date: string; fixedIds?: ReadonlySet<string>; total?: number },
): string {
  const fixedIds = opts.fixedIds ?? new Set<string>();
  const secured = countSecuredFor(hexagons, fixedIds);
  const groups = groupHexagons(hexagons);
  const todo = hexagons.filter((h) => isExposed(h, fixedIds));
  const next = todo.length
    ? `<section><h2>What to do next</h2><ul>${todo.map((h) => `<li><strong>${escapeHtml(h.label)}</strong>${h.remediation ? ` ${escapeHtml(h.remediation)}` : ''}</li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
body{margin:0;background:#fff;color:#111827;font:15px/1.5 Inter,system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 20px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;padding-bottom:16px}
h1{margin:0;font-size:28px}.meta{color:#6b7280}
.grid{display:grid;gap:32px 24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));margin-top:24px}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 8px}
svg{display:block;margin:0 auto;max-width:100%;height:auto}
ul{padding-left:20px}section{break-inside:avoid}
@media print{main{padding:0}@page{margin:14mm}}
</style></head><body><main>
<header><h1>${escapeHtml(opts.title)}</h1><span class="meta">${secured} ${secured === 1 ? 'tile' : 'tiles'} checked · ${escapeHtml(opts.date)}</span></header>
<div class="grid">${groups.map((g) => `<section><h2>${escapeHtml(g.title)}</h2>${pillarSvg(g.items, fixedIds)}</section>`).join('')}</div>
${next}
</main></body></html>`;
}
