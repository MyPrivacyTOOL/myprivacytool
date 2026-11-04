// Machine mirror rollup (MPC-7492). Pure functions: turn the per-user-agent daily aggregate (public.mpt_machine_visits_daily, bot and AI
// rows only) into one row per family with requests, pages, first/last seen, share of all traffic and robots.txt use, then flag changes.
// Nothing here ever sees a person or unknown row: the SQL function does not return them, and rollup() drops any class but bot/ai again.

export const MACHINE_CLASSES = ['bot', 'ai'];
export const TENFOLD = 10;
// A tenfold change on a handful of requests is noise (1 -> 10). Both flags need at least this many requests on the larger day.
export const MIN_REQUESTS_FOR_CHANGE = 20;
export const MAX_PAGES_LISTED = 25;

// Named families, in the same spelling as the classifier's token lists (shared/edge-capture/ruleset.ts). A test keeps the two in step.
export const KNOWN_FAMILIES = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot',
  'Perplexity-User', 'CCBot', 'Bytespider', 'Amazonbot', 'Applebot-Extended', 'Google-Extended', 'meta-externalagent',
  'meta-externalfetcher', 'cohere-ai', 'Diffbot', 'YouBot', 'MistralAI-User',
  'Googlebot', 'Bingbot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot', 'Slurp',
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'UptimeRobot', 'Pingdom', 'curl', 'python-requests', 'Go-http-client', 'okhttp',
  'Scrapy', 'HeadlessChrome', 'PhantomJS', 'node-fetch', 'wget', 'libwww-perl', 'Java', 'axios', 'aiohttp',
];
const GENERIC = /([A-Za-z0-9_.-]*(?:bot|crawler|spider|scraper|fetcher|monitor)[A-Za-z0-9_.-]*)/i;

// Longer names first so "Applebot-Extended" wins over "Applebot" and "Claude-SearchBot" over nothing shorter.
const BY_LENGTH = [...KNOWN_FAMILIES].sort((a, b) => b.length - a.length);

export function familyOf(userAgent) {
  const ua = String(userAgent ?? '').trim();
  if (!ua) return '(no user agent)';
  const lower = ua.toLowerCase();
  const known = BY_LENGTH.find((f) => lower.includes(f.toLowerCase() + (/^(curl|wget|java|axios)$/i.test(f) ? '/' : '')));
  if (known) return known;
  const generic = GENERIC.exec(ua)?.[1];
  if (generic) return generic.replace(/^[-.]+|[-.]+$/g, '');
  const product = /^([A-Za-z][A-Za-z0-9_.-]*)/.exec(ua)?.[1];
  return product && product.toLowerCase() !== 'mozilla' ? product : '(other agent)';
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const min = (a, b) => (a === null ? b : b === null ? a : a < b ? a : b);
const max = (a, b) => (a === null ? b : b === null ? a : a > b ? a : b);

// rows: the "rows" array of the SQL aggregate. Returns families sorted by requests, busiest first.
export function rollup(agg) {
  const total = Number(agg?.total_requests) || 0;
  const by = new Map();
  for (const r of agg?.rows ?? []) {
    if (!MACHINE_CLASSES.includes(r.class)) continue; // person / unknown never enter the output
    const name = familyOf(r.user_agent);
    const f = by.get(name) ?? { family: name, class: r.class, _classRequests: {}, requests: 0, _pages: new Set(), first_seen: null, last_seen: null, first_ever: null, robots_fetches: 0 };
    const n = Number(r.requests) || 0;
    f.requests += n;
    f._classRequests[r.class] = (f._classRequests[r.class] ?? 0) + n;
    for (const p of r.pages ?? []) f._pages.add(p);
    f.first_seen = min(f.first_seen, iso(r.first_seen));
    f.last_seen = max(f.last_seen, iso(r.last_seen));
    f.first_ever = min(f.first_ever, iso(r.first_ever));
    f.robots_fetches += Number(r.robots_fetches) || 0;
    by.set(name, f);
  }
  return [...by.values()].map((f) => {
    const cls = Object.entries(f._classRequests).sort((a, b) => b[1] - a[1])[0][0];
    const pages = [...f._pages].sort();
    return {
      family: f.family, class: cls, requests: f.requests,
      pages_taken: pages.length, pages: pages.slice(0, MAX_PAGES_LISTED),
      first_seen: f.first_seen, last_seen: f.last_seen, first_ever: f.first_ever,
      share_pct: total > 0 ? Math.round((f.requests / total) * 10000) / 100 : null,
      robots_fetches: f.robots_fetches, fetched_robots_txt: f.robots_fetches > 0,
    };
  }).sort((a, b) => b.requests - a.requests || a.family.localeCompare(b.family));
}

// Flags. todayFamilies / prevFamilies are rollup() outputs; windowStart is the instant today's window began.
//  - new_family: the family's first_ever sighting falls inside today's window (never seen before today).
//  - tenfold_up / tenfold_down: requests changed by 10x or more against the previous day, when the busier day has at least
//    MIN_REQUESTS_FOR_CHANGE requests. A family that vanished (0 today) counts as down; a family absent yesterday but seen before is "returned", not flagged.
export function flags(todayFamilies, prevFamilies, windowStart) {
  const start = new Date(windowStart).getTime();
  const prev = new Map(prevFamilies.map((f) => [f.family, f.requests]));
  const out = [];
  const today = new Map(todayFamilies.map((f) => [f.family, f]));
  for (const f of todayFamilies) {
    if (f.first_ever && new Date(f.first_ever).getTime() >= start) { out.push({ flag: 'new_family', family: f.family, class: f.class, requests: f.requests }); continue; }
    const p = prev.get(f.family) ?? 0;
    if (p > 0 && f.requests >= TENFOLD * p && f.requests >= MIN_REQUESTS_FOR_CHANGE) out.push({ flag: 'tenfold_up', family: f.family, class: f.class, requests: f.requests, previous: p });
  }
  for (const f of prevFamilies) {
    if (today.has(f.family)) {
      const t = today.get(f.family).requests;
      if (t > 0 && f.requests >= TENFOLD * t && f.requests >= MIN_REQUESTS_FOR_CHANGE) out.push({ flag: 'tenfold_down', family: f.family, class: f.class, requests: t, previous: f.requests });
    } else if (f.requests >= MIN_REQUESTS_FOR_CHANGE) {
      out.push({ flag: 'tenfold_down', family: f.family, class: f.class, requests: 0, previous: f.requests });
    }
  }
  return out;
}
