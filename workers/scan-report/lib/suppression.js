// MPC-7448: opt-outs for people who have no `users` row (e.g. /HongKongSpam registrants). users.email_opt_out_at is keyed by a users row,
// so an unsubscribe from a registrant would match nothing. email_suppressions is keyed by SHA-256(lower-cased address): no readable
// address is stored. Both stores are checked before any marketing-style send.
const norm = (e) => String(e || '').trim().toLowerCase();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function emailHash(email) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm(email))));
}

// Called by the unsubscribe handler. Idempotent (a duplicate row is fine).
export async function addSuppression(sb, email, source = 'unsubscribe') {
  try { await sb.insert('email_suppressions', { email_hash: await emailHash(email), source }); }
  catch (e) { if (e.status !== 409) throw e; }
}

// PostgREST in.(...) list with double-quoted values.
const inList = (vals) => `(${vals.map((v) => `"${String(v).replace(/[\\"]/g, '\\$&')}"`).join(',')})`;

// Returns the Set of (lower-cased) addresses that must not be mailed: users.email_opt_out_at set, or a suppression row.
export async function suppressedAmong(sb, emails) {
  const list = [...new Set(emails.map(norm))];
  const out = new Set();
  if (!list.length) return out;
  const users = await sb.select(`users?email=in.${encodeURIComponent(inList(list))}&email_opt_out_at=not.is.null&select=email`);
  for (const u of users) out.add(norm(u.email));
  const hashes = new Map();
  for (const e of list) hashes.set(await emailHash(e), e);
  const rows = await sb.select(`email_suppressions?email_hash=in.${encodeURIComponent(`(${[...hashes.keys()].join(',')})`)}&select=email_hash`);
  for (const r of rows) if (hashes.has(r.email_hash)) out.add(hashes.get(r.email_hash));
  return out;
}
