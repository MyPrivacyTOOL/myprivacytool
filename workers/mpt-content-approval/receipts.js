// CK-8482: truthful per-platform publication receipts, bounded recovery and cycle classification.
// Pure of Make/Slack I/O: D1 (`db.prepare(sql).bind(...).run()/.all()`) is the only dependency, so every path is
// unit-testable offline. Orchestration (resend, alerts, routes) lives in worker.js.
//
// State machine per (drafted_content_id, platform):
//   drafted -> approved -> handed_off -> verified_published
//   approved|handed_off -> failed -> approved (a bounded retry)      failed + dead_letter is terminal
// A Make HTTP 2xx is `handed_off` ONLY. `verified_published` needs an authenticated receipt with a post id and URL.

export const STATES = ['drafted', 'approved', 'handed_off', 'verified_published', 'failed'];
export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_S = 60;
export const BACKOFF_CAP_S = 3600;
export const RECEIPT_TOLERANCE_S = 300;

// Hosts a platform's post URL may live on. A receipt whose URL is elsewhere is not about that platform.
export const PLATFORM_HOSTS = {
  x: ['x.com', 'twitter.com'],
  linkedin: ['linkedin.com'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  pinterest: ['pinterest.com', 'pin.it'],
  youtube: ['youtube.com', 'youtu.be'],
  reddit: ['reddit.com', 'redd.it'],
};

const encoder = new TextEncoder();
const iso = (d = new Date()) => d.toISOString();
const rowId = (contentId, platform) => `${contentId}:${platform}`;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Exponential backoff in seconds, honouring a provider Retry-After (seconds) but never past the cap. */
export function backoffSeconds(attempt, retryAfterS = 0) {
  const exp = Math.min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2 ** Math.max(0, attempt - 1));
  const ra = Number.isFinite(retryAfterS) && retryAfterS > 0 ? Math.min(BACKOFF_CAP_S, retryAfterS) : 0;
  return Math.max(exp, ra);
}

/** Retry-After header: delta-seconds or an HTTP date. Returns seconds (0 when absent/unparseable). */
export function parseRetryAfter(value, now = new Date()) {
  if (!value) return 0;
  if (/^\d+$/.test(String(value).trim())) return Number(value);
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.ceil((t - now.getTime()) / 1000));
}

async function getRows(db, contentId) {
  const { results } = await db.prepare('SELECT * FROM publication_receipts WHERE content_id = ?').bind(contentId).all();
  return results ?? [];
}
export const rowsFor = getRows;

async function upsertNew(db, contentId, platform, state, now) {
  // INSERT OR IGNORE: re-approval of the same cycle never resets a platform that already progressed.
  await db.prepare('INSERT OR IGNORE INTO publication_receipts (id, content_id, platform, state, attempts, updated_at) VALUES (?, ?, ?, ?, 0, ?)')
    .bind(rowId(contentId, platform), contentId, platform, state, iso(now)).run();
}
async function setRow(db, id, fields) {
  const keys = Object.keys(fields);
  await db.prepare(`UPDATE publication_receipts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => fields[k]), id).run();
}

export async function recordDrafted(db, contentId, platforms, now = new Date()) {
  for (const p of platforms) await upsertNew(db, contentId, p, 'drafted', now);
}

/** Platforms eligible to be (re)sent: never handed off / verified, not dead-lettered, not awaiting reconciliation. */
export function sendable(rows, platforms, now = new Date()) {
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  return platforms.filter((p) => {
    const r = byPlatform.get(p);
    if (!r) return true;
    if (r.state === 'handed_off' || r.state === 'verified_published') return false;
    if (r.dead_letter || r.outcome_unknown) return false;
    if (r.next_attempt_at && Date.parse(r.next_attempt_at) > now.getTime()) return false;
    return true;
  });
}

export async function recordApproved(db, contentId, platforms, now = new Date()) {
  for (const p of platforms) {
    await upsertNew(db, contentId, p, 'approved', now);
    await db.prepare("UPDATE publication_receipts SET state = 'approved', updated_at = ? WHERE id = ? AND state IN ('drafted','failed') AND dead_letter = 0")
      .bind(iso(now), rowId(contentId, p)).run();
  }
}

/** Make accepted the webhook for these platforms. Handoff only: never verified_published. */
export async function recordHandedOff(db, contentId, platforms, { makeRunId = null, now = new Date() } = {}) {
  for (const p of platforms) {
    await upsertNew(db, contentId, p, 'approved', now);
    await db.prepare("UPDATE publication_receipts SET state = 'handed_off', attempts = attempts + 1, handed_off_at = ?, make_run_id = COALESCE(?, make_run_id), outcome_unknown = 0, last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND state IN ('drafted','approved','failed')")
      .bind(iso(now), makeRunId, iso(now), rowId(contentId, p)).run();
  }
}

/**
 * A hand-off attempt did not succeed.
 *  ambiguous=true  (timeout / network error: the request may have been delivered) -> outcome_unknown, NO resend until reconciled
 *  ambiguous=false (a definite 429/5xx/4xx response)                              -> bounded retry with backoff, or dead letter
 * Returns { deadLettered: string[], scheduled: string[], unknown: string[] }.
 */
export async function recordHandoffFailure(db, contentId, platforms, { error, ambiguous = false, retryAfterS = 0, now = new Date(), maxAttempts = MAX_ATTEMPTS } = {}) {
  const out = { deadLettered: [], scheduled: [], unknown: [] };
  for (const p of platforms) {
    const id = rowId(contentId, p);
    await upsertNew(db, contentId, p, 'approved', now);
    const cur = (await getRows(db, contentId)).find((r) => r.platform === p);
    const attempts = (cur?.attempts ?? 0) + 1;
    if (ambiguous) {
      await setRow(db, id, { attempts, outcome_unknown: 1, last_error: error, updated_at: iso(now) });
      out.unknown.push(p);
    } else if (attempts >= maxAttempts) {
      await setRow(db, id, { state: 'failed', attempts, dead_letter: 1, next_attempt_at: null, last_error: error, updated_at: iso(now) });
      out.deadLettered.push(p);
    } else {
      const next = new Date(now.getTime() + backoffSeconds(attempts, retryAfterS) * 1000);
      await setRow(db, id, { state: 'failed', attempts, next_attempt_at: iso(next), last_error: error, updated_at: iso(now) });
      out.scheduled.push(p);
    }
  }
  return out;
}

/** Reconciliation outcome for an ambiguous hand-off. 'received' -> handed_off; 'not_received' -> may be re-sent. */
export async function applyReconciliation(db, contentId, platform, verdict, { source = 'unknown', makeRunId = null, now = new Date() } = {}) {
  const id = rowId(contentId, platform);
  if (verdict === 'received') {
    await setRow(db, id, { state: 'handed_off', outcome_unknown: 0, make_run_id: makeRunId, handed_off_at: iso(now), provenance: `reconcile:${source}`, updated_at: iso(now) });
  } else if (verdict === 'not_received') {
    await setRow(db, id, { state: 'failed', outcome_unknown: 0, next_attempt_at: iso(now), updated_at: iso(now) });
  } // 'unknown' (or anything else) leaves the row pending: unknown is never published and never resent.
  return verdict;
}

/**
 * Authenticate and validate a platform receipt, then apply it.
 * Body: { receipt_id, drafted_content_id, platform, status: 'published'|'failed', make_run_id, post_id, post_url, published_at, error? }
 * Headers: x-receipt-timestamp (unix seconds), x-receipt-signature = hex HMAC-SHA256(secret, `${ts}.${rawBody}`).
 * Returns { status, message, state? }. Never throws.
 */
export async function handleReceipt(env, rawBody, headers, nowMs = Date.now()) {
  if (!env.RECEIPT_SIGNING_SECRET) return { status: 503, message: 'receipts not configured' };
  const ts = headers.get('x-receipt-timestamp');
  const sig = headers.get('x-receipt-signature');
  if (!ts || !sig || !/^\d+$/.test(ts)) return { status: 401, message: 'missing signature' };
  if (Math.abs(nowMs / 1000 - Number(ts)) > RECEIPT_TOLERANCE_S) return { status: 401, message: 'stale timestamp' };
  if (!safeEqual(await hmacHex(env.RECEIPT_SIGNING_SECRET, `${ts}.${rawBody}`), sig)) return { status: 401, message: 'bad signature' };

  let b;
  try { b = JSON.parse(rawBody); } catch { return { status: 400, message: 'bad json' }; }
  const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 500;
  if (!b || !text(b.receipt_id) || !/^daily-posts-\d{4}-\d{2}-\d{2}$/.test(b.drafted_content_id ?? '') || !(b.platform in PLATFORM_HOSTS)) {
    return { status: 400, message: 'invalid receipt fields' };
  }
  if (b.status !== 'published' && b.status !== 'failed') return { status: 400, message: 'invalid status' };
  const now = new Date(nowMs);
  const id = rowId(b.drafted_content_id, b.platform);
  const row = (await getRows(env.AGENT_LOGS, b.drafted_content_id)).find((r) => r.platform === b.platform);
  // Association: a receipt is only meaningful for a platform of this cycle that we actually handed off.
  if (!row || !['handed_off', 'verified_published', 'failed'].includes(row.state) || row.state === 'failed' && !row.handed_off_at) {
    return { status: 404, message: 'no hand-off for this content and platform' };
  }

  const { results: seen } = await env.AGENT_LOGS.prepare('SELECT receipt_id FROM receipt_callbacks WHERE receipt_id = ?').bind(b.receipt_id).all();
  if (seen?.length) return { status: 200, message: 'duplicate receipt ignored', state: row.state };

  if (b.status === 'failed') {
    if (row.state === 'verified_published') return { status: 409, message: 'already verified published' };
    await env.AGENT_LOGS.prepare('INSERT INTO receipt_callbacks (receipt_id, content_id, platform, received_at, result) VALUES (?, ?, ?, ?, ?)').bind(b.receipt_id, b.drafted_content_id, b.platform, iso(now), 'failed').run();
    await setRow(env.AGENT_LOGS, id, { state: 'failed', make_run_id: b.make_run_id ?? row.make_run_id, last_error: String(b.error ?? 'platform reported failure').slice(0, 500), next_attempt_at: iso(now), provenance: `callback:${b.receipt_id}`, updated_at: iso(now) });
    return { status: 200, message: 'failure recorded', state: 'failed' };
  }

  if (!text(b.make_run_id) || !text(b.post_id) || !text(b.post_url) || Number.isNaN(Date.parse(b.published_at))) {
    return { status: 400, message: 'a published receipt needs make_run_id, post_id, post_url, published_at' };
  }
  let host;
  try { const u = new URL(b.post_url); host = u.protocol === 'https:' ? u.hostname.toLowerCase() : null; } catch { host = null; }
  if (!host || !PLATFORM_HOSTS[b.platform].some((h) => host === h || host.endsWith(`.${h}`))) {
    return { status: 400, message: 'post_url does not belong to the platform' };
  }
  if (row.state === 'verified_published') {
    // A different post for an already-verified platform is a conflict to investigate, never an overwrite.
    return row.post_id === b.post_id ? { status: 200, message: 'already verified', state: row.state } : { status: 409, message: 'conflicting post id for verified platform' };
  }
  await env.AGENT_LOGS.prepare('INSERT INTO receipt_callbacks (receipt_id, content_id, platform, received_at, result) VALUES (?, ?, ?, ?, ?)').bind(b.receipt_id, b.drafted_content_id, b.platform, iso(now), 'published').run();
  await setRow(env.AGENT_LOGS, id, {
    state: 'verified_published', make_run_id: b.make_run_id, post_id: b.post_id, post_url: b.post_url,
    published_at: new Date(b.published_at).toISOString(), provenance: `callback:${b.receipt_id}`, outcome_unknown: 0, last_error: null, next_attempt_at: null, updated_at: iso(now),
  });
  // The metrics seed row exists only once a post is verified, with the real id and URL (was written at hand-off before CK-8482).
  await env.AGENT_LOGS.prepare('INSERT INTO social_metrics (id, timestamp, platform, post_id, url, impressions, engagement) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .bind(crypto.randomUUID(), iso(now), b.platform, b.post_id, b.post_url).run().catch((e) => console.error('social_metrics insert failed', e?.message));
  return { status: 200, message: 'verified', state: 'verified_published' };
}

/**
 * Stage report for one cycle. "Waiting for approval" is NOT a failure.
 * overdueMs: how long after hand-off a receipt may take before the platform is flagged overdue.
 */
export function classifyCycle(rows, { now = new Date(), overdueMs = 6 * 3600e3 } = {}) {
  const stages = { generated: 0, awaiting_approval: 0, approved_not_sent: 0, handed_off: 0, verified_published: 0, failed: 0, unknown_outcome: 0, dead_letter: 0, overdue: 0 };
  const problems = [];
  for (const r of rows) {
    if (r.state === 'drafted') stages.awaiting_approval++;
    else if (r.state === 'approved') stages.approved_not_sent++;
    else if (r.state === 'verified_published') stages.verified_published++;
    else if (r.state === 'handed_off') {
      stages.handed_off++;
      if (r.handed_off_at && now.getTime() - Date.parse(r.handed_off_at) > overdueMs) { stages.overdue++; problems.push({ platform: r.platform, kind: 'overdue_receipt' }); }
    } else if (r.state === 'failed') {
      stages.failed++;
      if (r.dead_letter) { stages.dead_letter++; problems.push({ platform: r.platform, kind: 'exhausted_recovery' }); }
    }
    if (r.outcome_unknown) { stages.unknown_outcome++; problems.push({ platform: r.platform, kind: 'unknown_outcome' }); }
  }
  stages.generated = rows.length;
  return { stages, problems, healthy: problems.length === 0 };
}

/** Missing daily cycles: expected content ids with no receipt rows at all. Pure. */
export function missingCycles(expectedIds, presentIds) {
  const have = new Set(presentIds);
  return expectedIds.filter((id) => !have.has(id));
}
