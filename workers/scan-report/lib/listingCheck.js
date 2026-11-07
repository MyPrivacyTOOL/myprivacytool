// MPC-9813 (F1 broker lookup, Chris Decision 7, 2026-11-07): the free check is "show us your listing".
// The visitor pastes the address of a page that lists them; we fetch THAT ONE PAGE and look, locally, for the details they typed about
// themselves. Nothing is ever searched: no broker search endpoint is called, no name is sent to any site, no search engine is used.
// Contract: docs/broker-lookup-contract-mpc-9812.md. Fetch/classify rules are the ones in workers/social-listeners/src/records-check.ts
// (MPC-8689), ported to plain JS for this Worker: https only, public host, short redirect chain, size cap, 8 s limit, no cookie, no referrer,
// nothing about the person in the request. If you change a rule there, change it here too (workers/scan-report/listing-check.test.mjs pins ours).
//
// Result per page (BrokerResult of the contract, free class):
//   state   listed | not_listed | not_checked
//   listed      the page shows the typed details; match exact | probable | possible (possible = a guess, say so)
//   not_listed  ONLY when the page loaded normally and shows none of them, or the site says the page no longer exists (404/410)
//   not_checked everything else, with a reason: fetch_blocked | timeout | no_identifiers | not_a_listing_page. NEVER not_listed.
// Only the result fields are stored. The page text is never stored or logged.
import { BROKER_SITES } from './brokers.js';

export const LISTING_URL_MAX = 3;
const MAX_REDIRECTS = 3;
export const PAGE_TIMEOUT_MS = 8000;
export const TOTAL_BUDGET_MS = 25000;
const MAX_BYTES = 1_500_000;
const UA = 'Mozilla/5.0 (compatible; MyPrivacyTOOL-page-check)';

export const NOT_CHECKED_REASONS = ['fetch_blocked', 'timeout', 'no_identifiers', 'not_a_listing_page'];

// ---------------------------------------------------------------- what the visitor typed
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const CONTROL = /[\u0000-\u001f\u007f]/;

/** An https address on a public-looking host. Not an IP address, not localhost or an internal name, no credentials, no odd port. Null otherwise. */
export function safeUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const h = u.hostname.toLowerCase();
  if (h.length > 253 || !/^[a-z0-9.-]+$/.test(h) || !h.includes('.') || /^\d+(\.\d+){3}$/.test(h) || h.startsWith('.') || h.endsWith('.')) return null;
  if (h === 'localhost' || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(h)) return null;
  return u;
}

// A search or lookup address is a request for the site to search for someone. We only read pages the person shows us, never run a search for them.
const SEARCH_PATH = /(^|\/)(search|results?|find|lookup|people-search)(\/|$)/i;
const SEARCH_QUERY = /^(q|query|s|term|name|fname|lname|first|last|firstname|lastname|first_name|last_name|fn|ln)$/i;
export function looksLikeSearch(u) {
  if (SEARCH_PATH.test(u.pathname)) return true;
  for (const k of u.searchParams.keys()) if (SEARCH_QUERY.test(k)) return true;
  return false;
}

/** The broker a host belongs to (registry key), or null for a site that is not on the shortlist. */
export function brokerForHost(host) {
  const h = String(host || '').toLowerCase();
  return BROKER_SITES.find((b) => b.domains.some((d) => h === d || h.endsWith(`.${d}`))) ?? null;
}

/**
 * The optional "listing" object of POST /api/scan. Returns { none: true } (nothing typed), { error } or { inputs }.
 * Every field is optional. Names the visitor typed about themselves only; the Worker never fills a missing one from anywhere else.
 */
export function parseListingRequest(b) {
  if (!b || typeof b !== 'object' || !('listing' in b)) return { none: true };
  const l = b.listing;
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { error: 'Invalid request' };
  for (const k of Object.keys(l)) if (!['full_name', 'city_region', 'country', 'phone', 'urls'].includes(k)) return { error: 'Invalid request' };
  const text = (v, n) => (v === undefined || v === null || v === '' ? null : typeof v === 'string' && !CONTROL.test(v) ? clip(v, n) || null : false);
  const full_name = text(l.full_name, 120);
  const city_region = text(l.city_region, 120);
  const countryRaw = text(l.country, 8);
  const phoneRaw = text(l.phone, 32);
  if (full_name === false || city_region === false || countryRaw === false || phoneRaw === false) return { error: 'Invalid request' };
  const country = countryRaw ? countryRaw.toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) return { error: 'Invalid request' };
  let phone = null;
  if (phoneRaw) {
    const digits = phoneRaw.replace(/\D/g, '');
    if (!/^[+\d\s().-]+$/.test(phoneRaw) || digits.length < 7 || digits.length > 15) return { error: 'Invalid request' };
    phone = (phoneRaw.startsWith('+') ? '+' : '') + digits;
  }
  const urls = [];
  if (l.urls !== undefined) {
    if (!Array.isArray(l.urls) || l.urls.length > LISTING_URL_MAX) return { error: 'Invalid request' };
    for (const raw of l.urls) {
      if (typeof raw !== 'string' || CONTROL.test(raw)) return { error: 'Invalid request' };
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const u = safeUrl(trimmed);
      if (!u) return { error: 'Invalid listing address' };
      if (!urls.includes(u.href)) urls.push(u.href);
    }
  }
  if (!full_name && !city_region && !country && !phone && urls.length === 0) return { none: true };
  return { inputs: { full_name, city_region, country, phone, urls } };
}

// ---------------------------------------------------------------- reading a page
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(0x10ffff, parseInt(h, 16))))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(0x10ffff, parseInt(d, 10))))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** Visible text of a page, lower case, one space between words. */
export function pageText(html) {
  return decode(html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bounded = (body) => new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');

/** The typed text, plus for a two or three word name "last, first", "last first" and "first M. last" (listings often show names that way). */
export function nameVariants(name) {
  const t = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const words = t.split(' ');
  const out = [escapeRe(t)];
  if (words.length >= 2 && words.length <= 3) {
    const last = words[words.length - 1]; const rest = words.slice(0, -1).join(' ');
    out.push(`${escapeRe(last)},? ${escapeRe(rest)}`);
    out.push(`${escapeRe(words[0])} (?:[a-z]\\.? )?${escapeRe(last)}`);   // optional middle initial
  }
  return out;
}
export const containsName = (haystack, name) => nameVariants(name).some((v) => bounded(v).test(haystack));
export const containsText = (haystack, term) => Boolean(term) && bounded(escapeRe(String(term).toLowerCase().replace(/\s+/g, ' ').trim())).test(haystack);

/** The number as it may be written on a page: digits in order with any spacing, dots, dashes or brackets between them. Uses the last 10 digits (country codes vary). */
export function containsPhone(haystack, phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7) return false;
  const tail = digits.length > 10 ? digits.slice(-10) : digits;
  const re = new RegExp(`(?<!\\d)(?:\\+?\\d{1,3}[\\s().-]*)?${tail.split('').map(escapeRe).join('[\\s().-]*')}(?!\\d)`);
  return re.test(haystack);
}

/** "Austin, TX" -> {city:'austin', region:'tx'}; "Hong Kong" -> {place:'hong kong'}. */
function splitPlace(cityRegion) {
  const parts = String(cityRegion || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], region: parts.slice(1).join(' ') };
  return { place: parts[0] || null };
}

/**
 * Pure. What the page shows of the identifiers.
 * exact    name + place both match (or name + phone, or the email itself is on the page)
 * probable name matches and part of the place, or the phone, matches
 * possible name only (or the phone alone): a guess, labelled as one
 * none      nothing of the above
 */
export function matchPage(text, rawLower, ids) {
  const nameHit = ids.full_name ? containsName(text, ids.full_name) : false;
  const phoneHit = ids.phone ? containsPhone(text, ids.phone) : false;
  const emailHit = ids.email ? containsText(rawLower, ids.email) : false;
  const pl = splitPlace(ids.city_region);
  let placeFull = false; let placePart = false;
  if (pl.city && pl.region) {
    const c = containsText(text, pl.city); const r = containsText(text, pl.region);
    placeFull = c && r; placePart = c || r;
  } else if (pl.place) {
    placeFull = containsText(text, pl.place); placePart = placeFull;
  }
  const hits = { name: nameHit, place: placeFull, place_part: placePart && !placeFull, phone: phoneHit, email: emailHit };
  if (emailHit) return { match: 'exact', confidence: 'high', hits };   // the confirmed email address itself is on the page
  if (nameHit && (placeFull || phoneHit)) return { match: 'exact', confidence: 'high', hits };
  if (nameHit && placePart) return { match: 'probable', confidence: 'medium', hits };
  if (nameHit || phoneHit) return { match: 'possible', confidence: 'low', hits };
  return { match: null, confidence: null, hits };
}

const CHALLENGE = /captcha|verify (that )?you are (a )?human|are you a robot|enable javascript|javascript (is )?(required|disabled)|access denied|just a moment|attention required|unusual traffic|checking your browser|request blocked/i;

/** Pure. The result for one fetched page. Never returns not_listed for a block, a challenge, an unreadable or a truncated page. */
export function classifyPage(page, ids) {
  const { status, contentType, body, truncated } = page;
  if (status === 404 || status === 410) return { state: 'not_listed', match: null, confidence: null, is_guess: false, not_checked_reason: null, note: 'page_gone' };
  const nc = (reason, note) => ({ state: 'not_checked', match: null, confidence: null, is_guess: false, not_checked_reason: reason, note });
  if (status < 200 || status >= 300) return nc('fetch_blocked', status === 403 || status === 401 || status === 429 || status === 451 ? 'site_refused' : 'site_error');
  if (!/^(text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(contentType)) return nc('not_a_listing_page', 'not_a_web_page');
  const text = pageText(body);
  const m = matchPage(text, decode(body).toLowerCase(), ids);
  if (m.match) return { state: 'listed', match: m.match, confidence: m.confidence, is_guess: m.match === 'possible', not_checked_reason: null, note: null };
  if (truncated) return nc('not_a_listing_page', 'too_big_to_read_in_full');
  if (text.length < 200 || CHALLENGE.test(text.length < 3000 ? text : text.slice(0, 3000))) return nc('fetch_blocked', 'page_did_not_show_content');
  return { state: 'not_listed', match: null, confidence: null, is_guess: false, not_checked_reason: null, note: 'absent' };
}

async function readCapped(res) {
  if (!res.body || typeof res.body.getReader !== 'function') return { body: await res.text(), truncated: false };
  const reader = res.body.getReader();
  const chunks = []; let size = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength; chunks.push(value);
    if (size > MAX_BYTES) { truncated = true; await reader.cancel().catch(() => undefined); break; }
  }
  const all = new Uint8Array(Math.min(size, MAX_BYTES + 65_536));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.byteLength, all.length - off); all.set(c.subarray(0, n), off); off += n; if (off >= all.length) break; }
  return { body: new TextDecoder('utf-8').decode(all.subarray(0, off)), truncated };
}

/** One page: a short redirect chain to the supplied address, nothing else. Never throws. */
export async function checkPage(rawUrl, ids, fetchImpl = fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PAGE_TIMEOUT_MS);
  try {
    let url = safeUrl(rawUrl);
    for (let hop = 0; url; hop++) {
      const res = await fetchImpl(url.href, {
        method: 'GET', redirect: 'manual', signal: ctl.signal,
        headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'User-Agent': UA },   // no cookie, no referrer, nothing about the person
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel?.().catch(() => undefined);
        if (!loc || hop >= MAX_REDIRECTS) return { state: 'not_checked', match: null, confidence: null, is_guess: false, not_checked_reason: 'fetch_blocked', note: 'too_many_redirects' };
        let next = null;
        try { next = safeUrl(new URL(loc, url).href); } catch { next = null; }
        if (!next || looksLikeSearch(next)) return { state: 'not_checked', match: null, confidence: null, is_guess: false, not_checked_reason: 'fetch_blocked', note: 'redirect_to_unsafe_address' };
        url = next;
        continue;
      }
      const { body, truncated } = await readCapped(res);
      return classifyPage({ status: res.status, contentType: res.headers.get('content-type') ?? '', body, truncated }, ids);
    }
    return { state: 'not_checked', match: null, confidence: null, is_guess: false, not_checked_reason: 'fetch_blocked', note: 'unsafe_address' };
  } catch {
    return { state: 'not_checked', match: null, confidence: null, is_guess: false, not_checked_reason: ctl.signal.aborted ? 'timeout' : 'fetch_blocked', note: ctl.signal.aborted ? 'timed_out' : 'could_not_fetch' };
  } finally {
    clearTimeout(timer);
  }
}

const NOT_CHECKED = (reason, note) => ({ state: 'not_checked', match: null, confidence: null, is_guess: false, not_checked_reason: reason, note });

/**
 * The contract's BrokerResult for each pasted page, in the order pasted. `ids` = the CONFIRMED identifiers: { email, full_name, city_region, phone }.
 * Never throws; one page failing never affects another. The whole step is bounded by TOTAL_BUDGET_MS: pages not finished by then are not_checked / timeout.
 */
export async function checkListingPages(urls, ids, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const usable = Boolean(ids.full_name || ids.phone);   // an email address alone is never on a listing page: ask for a name or phone rather than guess
  const stamp = () => now().toISOString();
  const one = async (raw) => {
    const u = safeUrl(raw);
    const site = u ? brokerForHost(u.hostname) : null;
    const base = {
      key: site?.key ?? 'other', name: site?.name ?? (u ? u.hostname.replace(/^www\./, '') : 'Unknown page'), host: u ? u.hostname : null,
      match: null, confidence: null, is_guess: false, evidence_url: u ? u.href : null,
      guide: site?.guide ?? null,
    };
    const done = (r) => ({ ...base, ...r, source: { class: 'free', provider: 'user_supplied_page', method: 'page_read', checked_at: stamp() } });
    if (!u) return done(NOT_CHECKED('not_a_listing_page', 'unsafe_address'));
    if (!usable) return done(NOT_CHECKED('no_identifiers', 'add_name_or_phone'));
    if (site?.fetchable === false) return done(NOT_CHECKED('fetch_blocked', 'sign_in_required'));
    if (looksLikeSearch(u)) return done(NOT_CHECKED('not_a_listing_page', 'search_address'));
    return done(await checkPage(u.href, ids, fetchImpl));
  };
  let budget;
  const gate = new Promise((resolve) => { budget = setTimeout(() => resolve('late'), TOTAL_BUDGET_MS); });
  try {
    return await Promise.all(urls.slice(0, LISTING_URL_MAX).map(async (raw) => {
    const r = await Promise.race([one(raw).catch(() => null), gate]);
    if (r && r !== 'late') return r;
    const u = safeUrl(raw);
    const site = u ? brokerForHost(u.hostname) : null;
    return {
      key: site?.key ?? 'other', name: site?.name ?? (u ? u.hostname.replace(/^www\./, '') : 'Unknown page'), host: u ? u.hostname : null,
      ...NOT_CHECKED('timeout', 'timed_out'), evidence_url: u ? u.href : null, guide: site?.guide ?? null,
      source: { class: 'free', provider: 'user_supplied_page', method: 'page_read', checked_at: stamp() },
    };
    }));
  } finally {
    clearTimeout(budget);
  }
}
