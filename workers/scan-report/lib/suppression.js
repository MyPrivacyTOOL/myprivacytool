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
  try { await sb.insert('email_suppressions', { email_hash: await emailHash(email), source }); return true; }
  catch (e) { if (e.status !== 409) throw e; return false; }   // true = newly recorded, false = was already there
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

/** True when this one address must not receive non-transactional email: users.email_opt_out_at set, or an email_suppressions row. */
export async function isOptedOut(sb, email) {
  return (await suppressedAmong(sb, [email])).has(norm(email));
}

/**
 * MPC-7555: THE opt-out. Every path that ends a person's non-transactional email calls this one function, so there is one record per address
 * (email_suppressions, keyed by SHA-256 of the lower-cased address) and every sender checks it with isOptedOut / suppressedAmong.
 * It also mirrors the opt-out onto users.email_opt_out_at (the report job reads that column), and deletes the address from the newsletter list.
 * Order matters: the newsletter row goes BEFORE the suppression row, so a failure leaves nothing half-done and the person can retry the link.
 * Returns true the first time an address is recorded, false on a repeat (so a confirmation email is sent once).
 */
export async function optOutEverywhere(sb, email, source = 'unsubscribe', now = new Date()) {
  const e = norm(email);
  await sb.patch(`users?email=eq.${encodeURIComponent(e)}`, { email_opt_out_at: now.toISOString() });
  const star = /\*/.test(e);   // a PostgREST wildcard in the address is matched exactly instead
  await sb.remove(`subscribers?email=${star ? 'eq.' : 'ilike.'}${encodeURIComponent(star ? e : e.replace(/[\\%_]/g, '\\$&'))}`);
  return addSuppression(sb, e, source);
}
