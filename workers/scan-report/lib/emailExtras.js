// MPC-8689 pilot: the extra email hexagons. Built and checked, but NOT part of the 7 email hexagons in emailHexagons.js: they are kept out of the report
// email, the live view (signal_type does not match email-*), the exposure score and every count until the owner approves a new score version.
// Same result shape and rules as emailHexagons.js: found / clear / not_checked, never a guess, free and public only, domain-only DNS lookups (the address is never sent out).
// Built from the discovery list (access OK): alias, address_type, saas_records, mail_protection.
// Not built: the four "If they email us" checks need an inbound Email Worker that does not exist yet; subdomains and WKD are Tier 3 queued jobs; PGP key servers and
// web archive are held for an owner decision.
import { CHECK_TIMEOUT_MS, PERSONAL_DOMAINS, ROLE_WORDS, dohQuery, splitEmail } from './emailHexagons.js';

export const EMAIL_EXTRA_HEXAGONS = {
  'email.alias': { label: 'Plus-address or alias', source: 'Analysed inside our Worker (nothing sent out)', services: [] },
  'email.address_type': { label: 'Address type', source: 'Analysed inside our Worker (nothing sent out)', services: [] },
  'email.saas_records': { label: 'Tools the domain uses', source: 'Cloudflare public DNS (TXT records)', services: ['Cloudflare DNS-over-HTTPS (receives the domain only, the part after the @)'] },
  'email.mail_protection': { label: 'Mail transport protection', source: 'Cloudflare public DNS (MTA-STS and TLS reporting records)', services: ['Cloudflare DNS-over-HTTPS (receives the domain only, the part after the @)'] },
};
export const EMAIL_EXTRA_IDS = Object.keys(EMAIL_EXTRA_HEXAGONS);
export const emailExtrasEnabled = (env = {}) => env.EMAIL_EXTRAS_ENABLED === 'true'; // default off

const result = (id, status, extra = {}) => ({ id, label: EMAIL_EXTRA_HEXAGONS[id].label, status, source: EMAIL_EXTRA_HEXAGONS[id].source, services: EMAIL_EXTRA_HEXAGONS[id].services, ...extra });
const notChecked = (id, reason) => result(id, 'not_checked', { reason: String(reason).slice(0, 200) });

// ---- alias (pure)
export function checkAlias(email) {
  const id = 'email.alias';
  const parts = splitEmail(email);
  if (!parts) return notChecked(id, 'not a valid email address');
  const at = parts.local.indexOf('+');
  if (at < 1 || at === parts.local.length - 1) return result(id, 'clear');
  return result(id, 'found', { value: `Your address uses a plus-tag (+${parts.local.slice(at + 1).slice(0, 40)}). The part before the + is your real mailbox, and the tag can show what the address was made for.` });
}

// ---- address type (pure): role mailbox, disposable, personal webmail or work/own domain
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'yopmail.com', 'tempmail.com', 'temp-mail.org', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'throwawaymail.com', 'maildrop.cc', 'dispostable.com']);
export function checkAddressType(email) {
  const id = 'email.address_type';
  const parts = splitEmail(email);
  if (!parts) return notChecked(id, 'not a valid email address');
  const base = parts.local.split('+')[0];
  const roleOnly = base.split(/[._-]+/).filter(Boolean).every((t) => ROLE_WORDS.has(t.replace(/\d+/g, '')));
  let value;
  if (DISPOSABLE.has(parts.domain)) value = 'a throwaway address from a disposable-mail service, which says little about who you are';
  else if (roleOnly) value = `a shared role mailbox (${base}@), which usually points to an organisation and not one person`;
  else if (PERSONAL_DOMAINS.has(parts.domain)) value = 'a personal webmail address shared by many people';
  else value = `a work or own-domain address (${parts.domain}), which can show which organisation you belong to`;
  return result(id, 'found', { value: `This looks like ${value}.` });
}

// ---- tools the domain uses (TXT verification records; domain only)
const SAAS_TXT = [
  [/^google-site-verification=/i, 'Google (Workspace or Search Console)'], [/^MS=ms\d+/i, 'Microsoft 365'], [/^atlassian-domain-verification=/i, 'Atlassian (Jira, Confluence)'],
  [/^docusign=/i, 'DocuSign'], [/^facebook-domain-verification=/i, 'Meta (Facebook business)'], [/^adobe-idp-site-verification=/i, 'Adobe'], [/^apple-domain-verification=/i, 'Apple'],
  [/^stripe-verification=/i, 'Stripe'], [/^ZOOM_verify_/i, 'Zoom'], [/^slack-domain-verification=/i, 'Slack'], [/^miro-verification=/i, 'Miro'],
  [/^_github-challenge-/i, 'GitHub (organisation)'], [/^hubspot-developer-verification=/i, 'HubSpot'], [/^dropbox-domain-verification=/i, 'Dropbox'],
];
async function withDns(id, email, timeoutMs, fn) {
  const parts = splitEmail(email);
  if (!parts || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(parts.domain)) return notChecked(id, 'not a valid email address');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fn(parts.domain, ctl.signal);
  } catch (e) {
    return notChecked(id, ctl.signal.aborted ? 'DNS lookup timed out' : `DNS lookup failed: ${String(e).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}
export function checkSaasRecords(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const id = 'email.saas_records';
  return withDns(id, email, timeoutMs, async (domain, signal) => {
    if (PERSONAL_DOMAINS.has(domain) || DISPOSABLE.has(domain)) return result(id, 'clear'); // a shared domain says nothing about this person
    const txt = await dohQuery(domain, 'TXT', fetchImpl, signal);
    if (txt.nx) return result(id, 'clear');
    const tools = [...new Set(txt.answers.map((t) => t.replace(/^"|"$/g, '').replace(/"\s*"/g, '')).flatMap((t) => SAAS_TXT.filter(([re]) => re.test(t)).map(([, name]) => name)))];
    return tools.length ? result(id, 'found', { value: `${domain} publishes records for: ${tools.join(', ')}. This shows which services the organisation signed up to.` }) : result(id, 'clear');
  });
}

// ---- mail transport protection (MTA-STS and TLS reporting; domain only)
export function checkMailProtection(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const id = 'email.mail_protection';
  return withDns(id, email, timeoutMs, async (domain, signal) => {
    if (PERSONAL_DOMAINS.has(domain) || DISPOSABLE.has(domain)) return result(id, 'clear'); // managed by the provider, not by this person
    const [sts, rpt] = await Promise.all([dohQuery(`_mta-sts.${domain}`, 'TXT', fetchImpl, signal), dohQuery(`_smtp._tls.${domain}`, 'TXT', fetchImpl, signal)]);
    const has = (r, re) => r.answers.some((t) => re.test(t.replace(/"/g, '')));
    const mta = has(sts, /^v=STSv1/i), tls = has(rpt, /^v=TLSRPTv1/i);
    return result(id, 'found', { value: `Mail sent to ${domain}: MTA-STS (forces encrypted delivery) ${mta ? 'published' : 'not found'}; TLS reporting ${tls ? 'published' : 'not found'}.` });
  });
}

// ---- run all (never throws, never exceeds the budget)
export async function runEmailExtras(email, env = {}, fetchImpl = fetch) {
  if (!emailExtrasEnabled(env)) return [];
  const budget = Number(env.EMAIL_HEXAGON_TIMEOUT_MS) || CHECK_TIMEOUT_MS;
  const guard = (id, p) => Promise.race([
    Promise.resolve(p).catch((e) => notChecked(id, `check failed: ${String(e).slice(0, 100)}`)),
    new Promise((r) => setTimeout(() => r(notChecked(id, 'timed out')), budget + 500)),
  ]);
  return Promise.all([
    guard('email.alias', checkAlias(email)),
    guard('email.address_type', checkAddressType(email)),
    guard('email.saas_records', checkSaasRecords(email, fetchImpl, { timeoutMs: budget })),
    guard('email.mail_protection', checkMailProtection(email, fetchImpl, { timeoutMs: budget })),
  ]);
}

// Rows for the `signals` table. signal_type is "extra-<id>", which the live view never reads (it only reads email-*) and no score reads.
export function emailExtraSignalRows(scanId, extras) {
  return extras.map((h) => ({
    scan_id: scanId, category: 'email', signal_type: `extra-${h.id}`, severity: 'low', data_source: h.source.slice(0, 100),
    check_status: h.status === 'found' ? 'found' : h.status === 'clear' ? 'clear' : 'not_checked',
    details: (h.value || h.reason || '').slice(0, 500) || null, removal_status: 'manual_only',
  }));
}
