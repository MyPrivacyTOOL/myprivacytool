// MPC-7500: lead enrichment (Hunter) + readiness scoring for the mpt-leads Worker.
// Pure functions plus one fetch wrapper; no module state. Scores are 0-100, High Priority is > 80.

export const HIGH_PRIORITY_THRESHOLD = 80;

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com', 'qq.com', '163.com', 'fastmail.com', 'tutanota.com',
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'example.com', 'test.com',
]);

// Privacy-regulated markets first (GDPR / CCPA / UK-GDPR / PIPEDA / Privacy Act), then the rest of the EU/EEA.
const GEO_TIER1 = new Set(['US', 'GB', 'DE', 'FR', 'NL', 'IE', 'CA', 'AU']);
const GEO_TIER2 = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'PL', 'PT', 'RO',
  'SK', 'SI', 'ES', 'SE', 'NO', 'IS', 'LI', 'CH', 'NZ', 'SG', 'JP', 'KR', 'HK', 'BR', 'IL', 'AE',
]);

const ROLE_CORE = /\b(privacy|dpo|data protection|ciso|security|infosec|compliance|legal|counsel|gdpr|risk|trust|governance)\b/i;
const ROLE_ADJACENT = /\b(it|information technology|engineering|cto|technology|operations|product|platform|infrastructure|devops)\b/i;
const SENIOR_TITLE = /\b(chief|ceo|cto|ciso|coo|cio|founder|co-founder|owner|president|vp|vice president|head of|director|partner)\b/i;

export function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  return at < 0 ? '' : String(email).slice(at + 1).trim().toLowerCase();
}

export const isFreeMail = (domain) => !domain || FREE_MAIL.has(domain);

// Hunter returns employee counts as a range string ("51-250", "10001+") or a number.
export function employeeCount(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : 0;
}

// Normalise Hunter's combined-enrichment payload into the few fields scoring needs. Tolerates missing keys.
export function normaliseHunter(payload) {
  const d = payload?.data || {};
  const person = d.person || {};
  const company = d.company || {};
  const job = person.employment || {};
  return {
    title: String(job.title || '').slice(0, 120),
    seniority: String(job.seniority || '').toLowerCase(),
    department: String(job.role || job.subRole || '').toLowerCase(),
    company: String(company.name || job.name || '').slice(0, 120),
    country: String(person.geo?.countryCode || company.geo?.countryCode || '').toUpperCase().slice(0, 2),
    employees: employeeCount(company.metrics?.employees ?? company.employees),
    industry: String(company.category?.industry || '').slice(0, 80),
  };
}

// Fetch Hunter combined enrichment. Returns { status: 'ok'|'not_found'|'error'|'disabled', data }.
// 'error' means retry later (network, 429, 5xx); 'not_found' is a final answer (score on domain/geo alone).
export async function hunterEnrich(env, email) {
  if (!env.HUNTER_API_KEY) return { status: 'disabled', data: null };
  try {
    const url = `https://api.hunter.io/v2/combined/find?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(env.HUNTER_API_KEY)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return { status: 'not_found', data: null };
    if (!res.ok) {
      console.error('Hunter enrich failed:', res.status);
      return { status: 'error', data: null };
    }
    return { status: 'ok', data: normaliseHunter(await res.json()) };
  } catch (err) {
    console.error('Hunter enrich error:', String(err));
    return { status: 'error', data: null };
  }
}

// Domain (0-35): corporate domain 15 + company size up to 20. Free/disposable mail = 0 (B2C).
export function domainPoints(domain, e) {
  if (isFreeMail(domain)) return 0;
  const n = e?.employees || 0;
  const size = n >= 1000 ? 20 : n >= 200 ? 16 : n >= 50 ? 12 : n >= 10 ? 8 : n > 0 ? 4 : 2;
  return 15 + size;
}

// Role (0-40): seniority up to 25 + privacy/security relevance up to 15.
export function rolePoints(e) {
  if (!e) return 0;
  const text = `${e.title} ${e.department}`;
  let seniority = e.seniority === 'executive' ? 25 : e.seniority === 'senior' ? 18 : e.seniority === 'junior' ? 8 : 4;
  if (SENIOR_TITLE.test(e.title)) seniority = Math.max(seniority, e.seniority === 'executive' ? 25 : 20);
  const relevance = ROLE_CORE.test(text) ? 15 : ROLE_ADJACENT.test(text) ? 10 : text.trim() ? 4 : 0;
  return seniority + relevance;
}

// Geography (0-25).
export function geoPoints(country) {
  const c = String(country || '').toUpperCase();
  if (!c) return 5;
  return GEO_TIER1.has(c) ? 25 : GEO_TIER2.has(c) ? 18 : 10;
}

export function tierFor(score) {
  return score > HIGH_PRIORITY_THRESHOLD ? 'High' : score >= 50 ? 'Medium' : 'Low';
}

// enrichment: normalised Hunter data or null. country: fallback from the request (cf.country).
export function scoreLead({ email, enrichment, country }) {
  const domain = emailDomain(email);
  const b2b = !isFreeMail(domain);
  const geoCountry = enrichment?.country || country || '';
  const parts = { domain: domainPoints(domain, enrichment), role: b2b ? rolePoints(enrichment) : 0, geo: geoPoints(geoCountry) };
  const score = Math.min(100, parts.domain + parts.role + parts.geo);
  return { score, tier: tierFor(score), b2b, parts, domain };
}

// HubSpot contact properties for a scored lead. Custom properties are created by docs/lead-scoring-mpc-7500.md.
export function hubspotProps({ result, enrichment, status, now = new Date() }) {
  const p = {
    mpt_lead_score: String(result.score),
    mpt_lead_tier: result.tier,
    mpt_lead_segment: result.b2b ? 'B2B' : 'B2C',
    mpt_lead_enrich_status: status,
    mpt_lead_scored_at: now.toISOString(),
  };
  if (enrichment) {
    if (enrichment.title) p.jobtitle = enrichment.title;
    if (enrichment.company) p.company = enrichment.company;
  }
  return p;
}

// Full pipeline for one email. Returns { props, result } ready to write to HubSpot.
// status: 'scored' (final) | 'pending' (Hunter failed; the cron sweep retries and rescoring overwrites).
export async function enrichAndScore(env, email, cfCountry) {
  const domain = emailDomain(email);
  if (isFreeMail(domain)) {
    const result = scoreLead({ email, enrichment: null, country: cfCountry });
    return { result, props: hubspotProps({ result, enrichment: null, status: 'scored' }) };
  }
  const h = await hunterEnrich(env, email);
  const enrichment = h.status === 'ok' ? h.data : null;
  const result = scoreLead({ email, enrichment, country: cfCountry });
  const status = h.status === 'error' ? 'pending' : 'scored';
  return { result, props: hubspotProps({ result, enrichment, status }) };
}
