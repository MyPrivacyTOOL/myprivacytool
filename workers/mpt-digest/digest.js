// MPC-7383: pure digest builder. No I/O, so it is fully unit-testable.
// Rules (task spec): at most 5 lines; name any failed source; never show an estimate (blank stays blank).

const METRICS = [
  ['cumulativeScans', 'Cumulative Scans'],
  ['ga4ActiveUsers', 'GA4 Active Users'],
  ['currentMrr', 'Current MRR'],
  ['conversionRate', 'Conversion Rate %'],
  ['blogPosts', 'Blog Posts Published'],
  ['xThreads', 'X Threads Posted'],
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Week-on-week % change for each metric present in both rows. Blanks never produce a mover. */
export function movers(current, previous) {
  const out = [];
  if (!previous) return out;
  for (const [key, label] of METRICS) {
    const c = current[key];
    const p = previous[key];
    if (!isNum(c) || !isNum(p) || p === 0) continue;
    out.push({ label, from: p, to: c, pct: ((c - p) / Math.abs(p)) * 100 });
  }
  return out;
}

/**
 * current/previous: { cumulativeScans, targetScans, paceGapPct, paceStatus, ga4ActiveUsers, currentMrr,
 *   conversionRate, blogPosts, xThreads, agentPlan, decisions }  (null = blank/unavailable)
 * failedSources: names of sources whose status=error this week (e.g. ['ga4']).
 * Returns { text, lines }.
 */
export function buildDigest({ weekOf, current, previous, failedSources = [] }) {
  const lines = [];
  const c = current || {};

  if (!current) {
    lines.push(`MPT week of ${weekOf}: no tracker row found, nothing to report.`);
  } else if (isNum(c.cumulativeScans) && isNum(c.targetScans)) {
    lines.push(`MPT week of ${weekOf}: ${fmt(c.cumulativeScans)} scans against a target of ${fmt(c.targetScans)}.`);
  } else if (isNum(c.cumulativeScans)) {
    lines.push(`MPT week of ${weekOf}: ${fmt(c.cumulativeScans)} scans (target unavailable).`);
  } else {
    lines.push(`MPT week of ${weekOf}: scan count unavailable.`);
  }

  const gap = isNum(c.paceGapPct) ? ` (${c.paceGapPct > 0 ? '+' : ''}${fmt(c.paceGapPct)}% vs pace)` : '';
  lines.push(`Pace: ${c.paceStatus || 'unavailable'}${gap}`);

  const m = movers(c, previous);
  if (m.length) {
    const up = m.reduce((a, b) => (b.pct > a.pct ? b : a));
    const down = m.reduce((a, b) => (b.pct < a.pct ? b : a));
    const show = (x) => `${x.label} ${fmt(x.from)}→${fmt(x.to)} (${x.pct > 0 ? '+' : ''}${fmt(x.pct)}%)`;
    const upTxt = up.pct > 0 ? `up ${show(up)}` : 'up none';
    const downTxt = down.pct < 0 ? `down ${show(down)}` : 'down none';
    lines.push(`Biggest movers: ${upTxt}; ${downTxt}.`);
  } else {
    lines.push('Biggest movers: not available (no comparable previous week).');
  }

  lines.push(c.agentPlan ? `Agent plan: ${c.agentPlan}` : 'Agent plan: none recorded.');

  const tail = [];
  if (failedSources.length) tail.push(`DATA GAP: ${failedSources.join(', ')} failed, cells left blank`);
  tail.push(c.decisions ? `Needs your decision: ${c.decisions}` : 'Needs your decision: nothing');
  lines.push(tail.join(' | '));

  return { lines, text: lines.join('\n') };
}
