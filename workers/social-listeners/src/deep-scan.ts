// MPC-7892 Telegram DEEP v1 (allow-listed test accounts only, default off). An explicit "DEEP" message in the private chat starts a consent step;
// "DEEP YES" runs a username check for THE SENDER'S OWN @username against a fixed list of public profile endpoints. Opening a link, HELP or any other
// message never starts it. Wording is DRAFT pending Chris's approval. A username match is NOT proof of identity; a block, timeout or error is NOT an all-clear.
import type { Logger } from "./logger";
import { call, probeIds, telegramSender } from "./probe-reader";
import type { Env } from "./shared";

export const DETECTOR_VERSION = "mpt-seed-sites-1";
export const CONSENT_TEXT_VERSION = "deep-consent-1";
const TIMEOUT_MS = 5000;
const DEADLINE_MS = 25_000;
const CONCURRENCY = 4;
const MAX_BODY_BYTES = 65_536;
const CONSENT_WINDOW_MS = 15 * 60_000;
const STALE_RUNNING_MS = 3 * 60_000;
const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_JOBS_PER_DAY = 3;

export type ResultStatus = "found" | "not_found" | "unavailable" | "blocked" | "error";
interface Site { id: string; name: string; host: string; path: (u: string) => string; verdict: (status: number, body: unknown) => ResultStatus }

const byStatus = (status: number): ResultStatus => (status === 200 ? "found" : status === 404 ? "not_found" : status === 401 || status === 403 || status === 429 ? "blocked" : "unavailable");
/** Fixed list: hostnames are constants (no user-supplied host), every request is https GET with redirects refused. Seed list; WhatsMyName import is a follow-up. */
export const SITES: Site[] = [
  { id: "github", name: "GitHub", host: "api.github.com", path: (u) => `/users/${u}`, verdict: byStatus },
  { id: "gitlab", name: "GitLab", host: "gitlab.com", path: (u) => `/api/v4/users?username=${u}`, verdict: (s, b) => (s !== 200 ? byStatus(s) === "found" ? "unavailable" : byStatus(s) : Array.isArray(b) ? (b.length > 0 ? "found" : "not_found") : "unavailable") },
  { id: "keybase", name: "Keybase", host: "keybase.io", path: (u) => `/_/api/1.0/user/lookup.json?usernames=${u}&fields=basics`, verdict: (s, b) => (s !== 200 ? (byStatus(s) === "found" ? "unavailable" : byStatus(s)) : Array.isArray((b as { them?: unknown })?.them) ? (((b as { them: unknown[] }).them[0] ?? null) ? "found" : "not_found") : "unavailable") },
  { id: "hackernews", name: "Hacker News", host: "hacker-news.firebaseio.com", path: (u) => `/v0/user/${u}.json`, verdict: (s, b) => (s !== 200 ? byStatus(s) : b === null ? "not_found" : typeof b === "object" ? "found" : "unavailable") },
  { id: "codeberg", name: "Codeberg", host: "codeberg.org", path: (u) => `/api/v1/users/${u}`, verdict: byStatus },
  { id: "devto", name: "DEV Community", host: "dev.to", path: (u) => `/api/users/by_username?url=${u}`, verdict: byStatus },
  { id: "chesscom", name: "Chess.com", host: "api.chess.com", path: (u) => `/pub/player/${u}`, verdict: byStatus },
  { id: "lichess", name: "Lichess", host: "lichess.org", path: (u) => `/api/user/${u}`, verdict: byStatus },
  { id: "dockerhub", name: "Docker Hub", host: "hub.docker.com", path: (u) => `/v2/users/${u}/`, verdict: byStatus },
];

export const deepScanEnabled = (env: Env): boolean => env.TELEGRAM_DEEP_SCAN === "on";

export type DeepCommand = "start" | "yes" | "cancel" | "status";
/** Exact commands only (whole message), so a link, HELP, or a sentence containing the word never starts anything. */
export function parseDeepCommand(text: unknown): DeepCommand | null {
  if (typeof text !== "string") return null;
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  return t === "deep" ? "start" : t === "deep yes" ? "yes" : t === "deep cancel" ? "cancel" : t === "deep status" ? "status" : null;
}

interface Ctx { id: string; chatId: number | string; updateId: number; username: string | null; date: string | null }
/** The sender of a private message from an allow-listed test account, with their own @username; target is never taken from message text. */
export function deepSender(env: Env, update: unknown): { command: DeepCommand; ctx: Ctx } | null {
  const s = telegramSender(update);
  if (!s || !probeIds(env).has(s.id)) return null;
  const m = (update as { update_id?: unknown; message?: { text?: unknown; date?: unknown; from?: { username?: unknown } } });
  const command = parseDeepCommand(m.message?.text);
  if (!command || typeof m.update_id !== "number") return null;
  const u = m.message?.from?.username;
  return { command, ctx: { id: s.id, chatId: s.chatId, updateId: m.update_id, username: typeof u === "string" && /^[A-Za-z0-9_]{5,32}$/.test(u) ? u : null,
    date: typeof m.message?.date === "number" ? new Date(m.message.date * 1000).toISOString() : null } };
}
export const isDeepCommand = (env: Env, update: unknown): boolean => deepScanEnabled(env) && deepSender(env, update) !== null;

const retentionDays = (env: Env): number => { const n = Number.parseInt(env.DEEP_RETENTION_DAYS ?? "", 10); return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : DEFAULT_RETENTION_DAYS; };
const jobsPerDay = (env: Env): number => { const n = Number.parseInt(env.DEEP_JOBS_PER_DAY ?? "", 10); return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : DEFAULT_JOBS_PER_DAY; };

async function rest(env: Env, method: string, path: string, body?: unknown, prefer?: string): Promise<{ ok: boolean; status: number; rows: Record<string, unknown>[] }> {
  try {
    const res = await fetch(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method,
      headers: { apikey: env.SUPABASE_KEY!, authorization: `Bearer ${env.SUPABASE_KEY!}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let rows: Record<string, unknown>[] = [];
    try { const j = await res.json(); rows = Array.isArray(j) ? j : []; } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, rows };
  } catch {
    return { ok: false, status: 0, rows: [] };
  }
}

/** Reads at most MAX_BODY_BYTES; the rest is dropped, never stored. */
async function readCapped(res: Response): Promise<unknown> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let n = 0;
    while (n < MAX_BODY_BYTES) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); n += value.length; }
    void reader.cancel().catch(() => undefined);
    const buf = new Uint8Array(Math.min(n, MAX_BODY_BYTES)); let o = 0;
    for (const c of chunks) { const part = c.subarray(0, buf.length - o); buf.set(part, o); o += part.length; if (o >= buf.length) break; }
    return JSON.parse(new TextDecoder().decode(buf));
  } catch { return null; }
}

export interface SiteResult { source: string; site_name: string; status: ResultStatus; http_status: number; observed_at: string; evidence: Record<string, unknown>; limitation: string }
const LIMITATION = "A username match shows only that an account with this name exists on that site; it is not proof it is the same person. Not found, blocked or unavailable is not proof of no exposure.";

export async function checkSite(site: Site, username: string, deadline: number): Promise<SiteResult> {
  const observed_at = new Date().toISOString();
  const base = { source: site.id, site_name: site.name, observed_at, limitation: LIMITATION };
  const url = `https://${site.host}${site.path(encodeURIComponent(username))}`;
  const left = deadline - Date.now();
  if (left <= 0) return { ...base, status: "unavailable", http_status: 0, evidence: { reason: "deadline_reached" } };
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", headers: { Accept: "application/json", "User-Agent": "MyPrivacyTOOL-deep-check/1" }, signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, left)) });
    if (res.status >= 300 && res.status < 400) return { ...base, status: "unavailable", http_status: res.status, evidence: { reason: "redirect_refused" } };
    const body = await readCapped(res);
    return { ...base, status: site.verdict(res.status, body), http_status: res.status, evidence: { host: site.host, check: "public_profile_endpoint" } };
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ...base, status: timeout ? "unavailable" : "error", http_status: 0, evidence: { reason: timeout ? "timeout" : "network_error" } };
  }
}

/** Bounded concurrency; one site's failure never fails the others. */
export async function runChecks(username: string, sites: Site[] = SITES): Promise<SiteResult[]> {
  const deadline = Date.now() + DEADLINE_MS;
  const out: SiteResult[] = new Array(sites.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, async () => {
    while (next < sites.length) { const i = next++; out[i] = await checkSite(sites[i], username, deadline); }
  }));
  return out;
}

const q = encodeURIComponent;
const EXPLAIN = (u: string) => [
  `DEEP check (draft test wording). I would check whether the username @${u} (yours, from your Telegram account) exists on these public sites: ${SITES.map((s) => s.name).join(", ")}.`,
  "",
  `Data sent: only your username, to those sites, from our server. Your photo is not sent anywhere and no reverse-image check runs in this version. Results are stored with a job reference, up to ${DEFAULT_RETENTION_DAYS} days by default.`,
  "A match only means an account with that name exists; it does not prove it is you. A block or timeout does not mean you are not exposed.",
  "",
  'Reply "DEEP YES" within 15 minutes to run it, or "DEEP CANCEL". Anything else does nothing.',
].join("\n");

const send = (env: Env, c: Ctx, text: string) => call(env, "sendMessage", { chat_id: c.chatId, text });
const short = (id: unknown) => String(id).slice(0, 8);

export function summarise(jobId: string, username: string, results: SiteResult[], complete: boolean): string {
  const found = results.filter((r) => r.status === "found"), nf = results.filter((r) => r.status === "not_found");
  const unk = results.filter((r) => r.status !== "found" && r.status !== "not_found");
  return [
    `DEEP check ${complete ? "finished" : "ended early"} for @${username} (job ${short(jobId)}).`,
    "",
    `Account with this username found on: ${found.length ? found.map((r) => r.site_name).join(", ") : "none of the sites that answered"}. A username match is not proof it is you.`,
    `No account with this username: ${nf.length ? nf.map((r) => r.site_name).join(", ") : "none"}.`,
    ...(unk.length ? [`Could not check (blocked, timeout or error; this is NOT an all-clear): ${unk.map((r) => r.site_name).join(", ")}.`] : []),
    "Reverse-image check: not available in this version.",
    "Send DEEP STATUS to see this again.",
  ].join("\n");
}

async function latestJob(env: Env, id: string): Promise<Record<string, unknown> | null> {
  const r = await rest(env, "GET", `deep_jobs?platform=eq.telegram&sender_id=eq.${q(id)}&order=created_at.desc&limit=1`);
  return r.ok ? (r.rows[0] ?? null) : null;
}

/** Never throws, never logs usernames, results or the token. */
export async function handleDeepCommand(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const parsed = deepSender(env, update);
    if (!parsed || !env.TELEGRAM_BOT_TOKEN) return;
    const { command, ctx } = parsed;
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) { log.warn("deep_storage_unconfigured"); await send(env, ctx, "DEEP is not available right now."); return; }

    if (command === "start") {
      if (!ctx.username) { await send(env, ctx, "I can only run DEEP for your own @username, and this account has none set, so nothing was checked."); return; }
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const recent = await rest(env, "GET", `deep_jobs?platform=eq.telegram&sender_id=eq.${q(ctx.id)}&created_at=gte.${q(since)}&select=id&limit=${jobsPerDay(env) + 1}`);
      if (!recent.ok) { await send(env, ctx, "DEEP is not available right now."); return; }
      if (recent.rows.length >= jobsPerDay(env)) { await send(env, ctx, "DEEP daily limit reached for this account. Nothing was started."); return; }
      const ins = await rest(env, "POST", "deep_jobs?on_conflict=idempotency_key", {
        platform: "telegram", sender_id: ctx.id, idempotency_key: `telegram:${ctx.id}:${ctx.updateId}`, status: "awaiting_consent", query_username: ctx.username,
        schema_version: 1, detector_version: DETECTOR_VERSION, expires_at: new Date(Date.now() + retentionDays(env) * DAY_MS).toISOString(),
      }, "resolution=ignore-duplicates,return=representation");
      if (!ins.ok) { log.warn("deep_job_create_failed", { status: ins.status }); await send(env, ctx, "DEEP is not available right now."); return; }
      if (ins.rows.length === 0) return; // replayed update: already handled, send nothing twice
      await send(env, ctx, EXPLAIN(ctx.username));
      return;
    }

    if (command === "cancel") {
      const r = await rest(env, "PATCH", `deep_jobs?platform=eq.telegram&sender_id=eq.${q(ctx.id)}&status=in.(awaiting_consent,running)`, { status: "cancelled", finished_at: new Date().toISOString() }, "return=representation");
      await send(env, ctx, r.ok && r.rows.length ? "DEEP cancelled. Any check already in flight may still finish sending, but its results will not be reported as complete." : "Nothing to cancel.");
      return;
    }

    if (command === "status") {
      const job = await latestJob(env, ctx.id);
      if (!job) { await send(env, ctx, "No DEEP job found."); return; }
      let status = String(job.status);
      if (status === "running" && Date.now() - Date.parse(String(job.heartbeat_at ?? job.created_at)) > STALE_RUNNING_MS) {
        await rest(env, "PATCH", `deep_jobs?id=eq.${q(String(job.id))}&status=eq.running`, { status: "interrupted", finished_at: new Date().toISOString() });
        status = "interrupted";
      }
      if (status === "complete" || status === "partial") {
        const rs = await rest(env, "GET", `deep_osint_results?job_id=eq.${q(String(job.id))}&select=source,site_name,status,http_status,observed_at,evidence,limitation`);
        if (rs.ok) { await send(env, ctx, summarise(String(job.id), String(job.query_username), rs.rows as unknown as SiteResult[], status === "complete")); return; }
      }
      await send(env, ctx, `DEEP job ${short(job.id)}: ${status}${status === "interrupted" ? " (the worker stopped before finishing; no result. Send DEEP to start again)" : ""}.`);
      return;
    }

    // "yes": consent for the sender's most recent pending job, within the window. Conditional update makes duplicates a no-op.
    const job = await latestJob(env, ctx.id);
    const fresh = job && job.status === "awaiting_consent" && Date.now() - Date.parse(String(job.created_at)) <= CONSENT_WINDOW_MS;
    if (!job || !fresh) {
      if (job && job.status === "awaiting_consent") await rest(env, "PATCH", `deep_jobs?id=eq.${q(String(job.id))}&status=eq.awaiting_consent`, { status: "expired", finished_at: new Date().toISOString() });
      await send(env, ctx, "No pending DEEP request (or it expired). Send DEEP to start one.");
      return;
    }
    const now = new Date().toISOString();
    const claim = await rest(env, "PATCH", `deep_jobs?id=eq.${q(String(job.id))}&status=eq.awaiting_consent`, {
      status: "running", started_at: now, heartbeat_at: now, consent_at: ctx.date ?? now,
      consent: { text_version: CONSENT_TEXT_VERSION, confirming_update_id: ctx.updateId, sites: SITES.map((s) => s.id), photo_sent: false },
    }, "return=representation");
    if (!claim.ok || claim.rows.length === 0) return; // duplicate YES or already cancelled
    const jobId = String(job.id), username = String(job.query_username);
    await send(env, ctx, `Running DEEP for @${username} (job ${short(jobId)}). This takes up to about 30 seconds.`);
    const results = await runChecks(username);
    const rows = results.map((r) => ({ job_id: jobId, ...r, detector_version: DETECTOR_VERSION, schema_version: 1 }));
    const saved = await rest(env, "POST", "deep_osint_results?on_conflict=job_id,source", rows, "resolution=ignore-duplicates,return=minimal");
    const complete = results.every((r) => r.status === "found" || r.status === "not_found");
    const fin = await rest(env, "PATCH", `deep_jobs?id=eq.${q(jobId)}&status=eq.running`, { status: saved.ok ? (complete ? "complete" : "partial") : "failed", finished_at: new Date().toISOString() }, "return=representation");
    if (fin.ok && fin.rows.length === 0) { log.info("deep_job_not_running_at_finish"); return; } // cancelled meanwhile: no completion message
    await send(env, ctx, saved.ok ? summarise(jobId, username, results, complete) : "The check ran but I could not store the result, so I am not reporting it. Nothing was concluded.");
    log.info("deep_done", { complete, stored: saved.ok });
  } catch (err) {
    log.warn("deep_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
