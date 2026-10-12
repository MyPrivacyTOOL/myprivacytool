// Channel OSINT analytics (MPC-7641). Pure functions: join the per-platform funnel counts from public.mpt_channel_osint_daily with GA4
// sessions tagged utm_medium=channel_osint, and turn a week of daily rows into one line per platform. Counts only, nothing personal.
// A missing number stays null (blank), never an estimate. There is no spend data yet, so "ROI" is conversions per 100 DMs, not money.

export const CHANNEL_OSINT_MEDIUM = 'channel_osint'; // utm_medium on every link a channel bot sends; utm_source = the platform name
export const PLATFORM_ORDER = ['x', 'linkedin']; // the comparison the task asks for comes first; others (telegram, ...) follow alphabetically
export const FUNNEL = ['dms_received', 'consents_given', 'scan_requests', 'scans_completed', 'clicks', 'conversions'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const platformKey = (v) => String(v ?? '').trim().toLowerCase();
const rate = (n, d) => (num(n) !== null && num(d) !== null && d > 0 ? Math.round((n / d) * 10000) / 100 : null);

/** GA4 runReport(sessionSource, sessionMedium -> sessions) to { platform: sessions } for rows whose medium is channel_osint. */
export function clicksFromGa4(report) {
  const out = {};
  for (const r of report?.rows ?? []) {
    const [source, medium] = (r.dimensionValues ?? []).map((d) => platformKey(d.value));
    const sessions = Number(r.metricValues?.[0]?.value);
    if (medium !== CHANNEL_OSINT_MEDIUM || !source || !Number.isFinite(sessions)) continue;
    out[source] = (out[source] ?? 0) + sessions;
  }
  return out;
}

/** Merge the SQL funnel counts with GA4 clicks. clicks === null means GA4 could not be read: every clicks cell stays blank. */
export function mergeDay(funnel, clicks) {
  const by = new Map();
  const row = (p) => { if (!by.has(p)) by.set(p, { platform: p, dms_received: 0, consents_given: 0, scan_requests: 0, scans_completed: 0, clicks: clicks === null ? null : 0, conversions: 0 }); return by.get(p); };
  for (const p of funnel?.platforms ?? []) {
    const r = row(platformKey(p.platform));
    for (const k of ['dms_received', 'consents_given', 'scan_requests', 'scans_completed', 'conversions']) r[k] = num(Number(p[k])) ?? 0;
  }
  for (const [p, n] of Object.entries(clicks ?? {})) row(platformKey(p)).clicks = n;
  return [...by.values()].sort(byPlatform);
}

const byPlatform = (a, b) => {
  const ia = PLATFORM_ORDER.indexOf(a.platform), ib = PLATFORM_ORDER.indexOf(b.platform);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.platform.localeCompare(b.platform);
};

/** Sum several daily payloads (payload.platforms arrays) into one row per platform with the derived rates. Blank stays blank. */
export function rollupWeek(dailyPayloads) {
  const by = new Map();
  for (const day of dailyPayloads) {
    for (const p of day?.platforms ?? []) {
      const key = platformKey(p.platform);
      if (!by.has(key)) by.set(key, { platform: key, ...Object.fromEntries(FUNNEL.map((k) => [k, 0])), clicks_known: false });
      const r = by.get(key);
      for (const k of FUNNEL) {
        if (k === 'clicks') { if (num(p.clicks) !== null) { r.clicks += p.clicks; r.clicks_known = true; } continue; }
        r[k] += num(p[k]) ?? 0;
      }
    }
  }
  return [...by.values()].sort(byPlatform).map(({ clicks_known, ...r }) => ({
    ...r,
    clicks: clicks_known ? r.clicks : null,
    consent_rate_pct: rate(r.consents_given, r.dms_received),
    conversion_rate_pct: rate(r.conversions, r.dms_received),
    conversions_per_100_dms: r.dms_received > 0 ? Math.round((r.conversions / r.dms_received) * 10000) / 100 : null,
  }));
}

const fmt = (v) => (v === null || v === undefined ? 'n/a' : String(v));

/** The weekly note for Chris: one line per platform, a verdict line, and any data gap. Never an estimate. */
export function buildWeeklyText({ weekOf, platforms, daysWithData, gaps = [] }) {
  if (!platforms.length) {
    return [`Channel OSINT week of ${weekOf}: no channel activity recorded.${daysWithData ? '' : ' No daily rows were collected for this week.'}`, ...gaps.map((g) => `DATA GAP: ${g}`)].join('\n');
  }
  const lines = [`Channel OSINT week of ${weekOf} (${daysWithData}/7 days collected)`];
  for (const p of platforms) {
    lines.push(`${p.platform}: ${p.dms_received} DMs, ${p.consents_given} consents, ${p.scan_requests} scan requests, ${p.scans_completed} scans done, ${fmt(p.clicks)} clicks, ${p.conversions} leads (${fmt(p.conversions_per_100_dms)} per 100 DMs)`);
  }
  const ranked = platforms.filter((p) => p.conversions_per_100_dms !== null && p.dms_received >= 10).sort((a, b) => b.conversions_per_100_dms - a.conversions_per_100_dms);
  if (ranked.length >= 2 && ranked[0].conversions_per_100_dms > ranked[1].conversions_per_100_dms) lines.push(`Best return this week: ${ranked[0].platform} (${ranked[0].conversions_per_100_dms} leads per 100 DMs vs ${ranked[1].platform} ${ranked[1].conversions_per_100_dms}). No spend data yet, so this is not money ROI.`);
  else lines.push('Best return: not enough DMs (10+ on two platforms) to compare. No spend data yet, so this is not money ROI.');
  for (const g of gaps) lines.push(`DATA GAP: ${g}`);
  return lines.join('\n');
}
