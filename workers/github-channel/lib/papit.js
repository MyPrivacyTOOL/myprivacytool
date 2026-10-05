/**
 * GitHub -> PaPIT v1 transformer (MPC-115). Spec: docs/papit/schema-v1.md.
 *
 * PII policy: the output is built ONLY from derived values (language names, topic slugs, counts,
 * a role label). Email, real name, login, location, company, blog, avatar and the raw bio are never
 * copied into the output; the bio is read for keyword matching only. Free-text fields that do end up
 * in the output (topics) are normalised to [a-z0-9-] slugs, which also drops anything that looks
 * like an email or a name.
 */

export const ACTIVITY_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

// Decision G: fixed keyword rules (no LLM, $0). Order is the tie-breaker.
const ROLE_RULES = [
  ['Security Engineer', ['security', 'infosec', 'pentest', 'cybersecurity', 'cryptography', 'appsec']],
  ['Data / ML Engineer', ['machine-learning', 'machine learning', 'ml', 'ai', 'data-science', 'data science', 'deep-learning', 'pytorch', 'tensorflow', 'llm', 'nlp']],
  ['DevOps / SRE Engineer', ['devops', 'sre', 'kubernetes', 'terraform', 'docker', 'ansible', 'infrastructure', 'cloud']],
  ['Mobile Developer', ['ios', 'android', 'swift', 'kotlin', 'flutter', 'react-native', 'mobile']],
  ['Frontend Developer', ['frontend', 'front-end', 'react', 'vue', 'svelte', 'angular', 'css', 'html', 'ui']],
  ['Backend Developer', ['backend', 'back-end', 'api', 'django', 'spring', 'rails', 'express', 'graphql', 'microservices']],
  ['Full-Stack Developer', ['fullstack', 'full-stack', 'full stack']],
];

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const countBy = (arr) => {
  const m = new Map();
  for (const x of arr) if (x) m.set(x, (m.get(x) || 0) + 1);
  return m;
};

const topN = (map, n) => [...map.entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  .slice(0, n)
  .map(([k]) => k);

const matches = (haystack, kw) => new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:$|[^a-z0-9])`).test(haystack);

export function inferRole({ bio, topLanguages, topTopics, hasProjects }) {
  const text = [bio, ...topLanguages, ...topTopics].join(' ').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [role, kws] of ROLE_RULES) {
    const score = kws.filter((k) => matches(text, k)).length;
    if (score > bestScore) { best = role; bestScore = score; }
  }
  if (best) return best;
  return hasProjects ? 'Software Developer' : 'Unspecified';
}

// Decision F: events in the last 90 days. low <5, medium 5-50, high >50.
export function activityLevel(eventCount) {
  if (eventCount < 5) return 'low';
  return eventCount <= 50 ? 'medium' : 'high';
}

/** JSON.stringify with object keys sorted alphabetically at every depth (decision H). */
export function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return JSON.stringify(sort(value));
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {{profile:object, repos:object[], starred:object[], events:{created_at:string}[]}} raw
 * @param {{now?: Date}} opts
 */
export async function githubToPapit(raw, { now = new Date() } = {}) {
  const { profile = {}, repos = [], starred = [], events = [] } = raw || {};
  const own = repos.filter((r) => !r.fork && !r.private);

  const languages = countBy(own.map((r) => r.language));
  const repoTopics = countBy(own.flatMap((r) => (r.topics || []).map(slug)));
  const starTopics = countBy(starred.flatMap((r) => (r.topics || []).map(slug)));

  const cutoff = now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS;
  const recent = events.filter((e) => Date.parse(e.created_at) >= cutoff).length;

  const projectCount = Number.isFinite(profile.public_repos) ? profile.public_repos : own.length;

  const payload = {
    version: '1.0',
    generated_at: now.toISOString(),
    source_channel: 'github',
    core_identity: {
      career: {
        skills: topN(languages, 10),
        primary_role: inferRole({
          bio: profile.bio || '',
          topLanguages: topN(languages, 3),
          topTopics: topN(repoTopics, 3),
          hasProjects: projectCount > 0,
        }),
        public_projects_count: projectCount,
      },
    },
    behavioral: {
      interests: topN(starTopics, 15).filter(Boolean),
      activity_level: activityLevel(recent),
    },
    privacy_boundaries: { data_retention_days: 30, revocable: true },
  };

  // Receipt = SHA-256 of the canonical (sorted-key) JSON of everything above, i.e. the sanitized payload.
  return { ...payload, cryptographic_receipt: await sha256Hex(canonicalJson(payload)) };
}

/** Recompute and compare the receipt (used by tests and consumers). */
export async function verifyReceipt(profile) {
  const { cryptographic_receipt: receipt, ...rest } = profile;
  return receipt === (await sha256Hex(canonicalJson(rest)));
}
