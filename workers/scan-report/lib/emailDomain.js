// MPC-8453: can the domain of this address receive mail at all? The /scan form only checked that the address LOOKS like an address, so a typo or
// a made-up domain (wqefsda@1.com style, gmial.com) was accepted, stored, sent a confirmation and a report that bounced (hurting the sender
// reputation) while the real person never got theirs. Turnstile proves a human, not an inbox.
// What it checks: the domain (the part after the @) exists in public DNS, and publishes a mail route: an MX record, or (RFC 5321 implicit MX) an
// A/AAAA record. A "null MX" (`0 .`, RFC 7505) means "this domain accepts no mail". Only the domain leaves the Worker (Cloudflare DNS-over-HTTPS).
// Fails OPEN: a slow or failing lookup never blocks a real visitor. Shared webmail domains are trusted without a lookup.
import { PERSONAL_DOMAINS } from './emailHexagons.js';

const DOH = 'https://cloudflare-dns.com/dns-query';
const TIMEOUT_MS = 1500;
const TYPES = { MX: 15, A: 1, AAAA: 28 };

async function lookup(name, type, fetchImpl, signal) {
  const res = await fetchImpl(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal });
  if (!res.ok) throw new Error(`DNS HTTP ${res.status}`);
  const j = await res.json();
  if (j.Status !== 0 && j.Status !== 3) throw new Error(`DNS status ${j.Status}`);      // 0 ok, 3 NXDOMAIN; anything else is a failure, not an answer
  return { nx: j.Status === 3, answers: (j.Answer || []).filter((a) => a.type === TYPES[type]).map((a) => String(a.data || '')) };
}

/** -> { ok: true } (deliverable, or could not tell) or { ok: false, reason: 'no_such_domain' | 'no_mail' }. Never throws. */
export async function checkDeliverableDomain(email, fetchImpl = fetch, { timeoutMs = TIMEOUT_MS } = {}) {
  const at = String(email || '').lastIndexOf('@');
  const domain = at > 0 ? String(email).slice(at + 1).toLowerCase() : '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || PERSONAL_DOMAINS.has(domain)) return { ok: true };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const mx = await lookup(domain, 'MX', fetchImpl, ctl.signal);
    if (mx.nx) return { ok: false, reason: 'no_such_domain' };
    const routes = mx.answers.map((a) => a.trim().split(/\s+/));
    if (routes.length && routes.every((r) => r[r.length - 1] === '.' )) return { ok: false, reason: 'no_mail' };   // null MX: "0 ."
    if (routes.length) return { ok: true };
    const [a, aaaa] = await Promise.all([lookup(domain, 'A', fetchImpl, ctl.signal), lookup(domain, 'AAAA', fetchImpl, ctl.signal)]);
    if (a.nx && aaaa.nx) return { ok: false, reason: 'no_such_domain' };
    return a.answers.length || aaaa.answers.length ? { ok: true } : { ok: false, reason: 'no_mail' };
  } catch {
    return { ok: true };      // fail open
  } finally {
    clearTimeout(timer);
  }
}
