// MPC-7893: the bot side of the one-time dashboard link (allow-listed test accounts only, default off: TELEGRAM_DASHBOARD_LINKS=on).
// An exact "dashboard" or "/dashboard" message makes ONE link for the sender's newest complete, unexpired snapshot and replies with it.
// The link carries only a random UUID; the database keeps only its SHA-256, the page redeems it on a button press (shared/dashboard/handlers.ts).
// Asking for a link never runs a scan, a DEEP check or anything else. Never logs the link, the UUID or the sender's data.
import { LINK_MINUTES, sha256Hex } from "../../../shared/dashboard/crypto";
import type { Logger } from "./logger";
import { senderFilter, senderIds } from "./sender-key";
import { call, probeIds, telegramSender } from "./probe-reader";
import type { Env } from "./shared";

const TIMEOUT_MS = 5000;
const MAX_LINKS_PER_HOUR = 5;
const DEFAULT_BASE = "https://www.myprivacytool.io";

export const dashboardLinksEnabled = (env: Env): boolean => env.TELEGRAM_DASHBOARD_LINKS === "on";
/** MPC-8689: the footprint handoff link, its own switch (default off). */
export const footprintLinksEnabled = (env: Env): boolean => env.TELEGRAM_FOOTPRINT_LINKS === "on";

/** Exact commands only (whole message): a sentence or a pasted link containing the word never issues a link. */
export function isDashboardCommand(env: Env, update: unknown): boolean {
  if (!dashboardLinksEnabled(env)) return false;
  const s = telegramSender(update);
  if (!s || !probeIds(env).has(s.id)) return false;
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/?dashboard(@\w+)?$/i.test(text.trim());
}

async function rest(env: Env, method: string, path: string, body?: unknown, prefer?: string): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  try {
    const res = await fetch(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method,
      headers: { apikey: env.SUPABASE_KEY!, authorization: `Bearer ${env.SUPABASE_KEY!}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const rows = res.ok && method === "GET" ? ((await res.json().catch(() => [])) as Record<string, unknown>[]) : [];
    return { ok: res.ok, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}

const base = (env: Env): string => (env.DASHBOARD_BASE_URL && /^https:\/\/[a-z0-9.-]+$/i.test(env.DASHBOARD_BASE_URL) ? env.DASHBOARD_BASE_URL : DEFAULT_BASE);

/** MPC-8689: exact "footprint" / "/footprint" only, same allow-list rule as the dashboard command. */
export function isFootprintCommand(env: Env, update: unknown): boolean {
  if (!footprintLinksEnabled(env)) return false;
  const s = telegramSender(update);
  if (!s || !probeIds(env).has(s.id)) return false;
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/?footprint(@\w+)?$/i.test(text.trim());
}

interface LinkKind { scope: "dashboard" | "footprint"; path: string; message: (url: string) => string; log: string; unavailable: string }
const DASHBOARD_LINK: LinkKind = {
  scope: "dashboard", path: "/d/", log: "dashboard_link", unavailable: "The dashboard is not available right now.",
  message: (url) => `Your private dashboard link (works once, expires in ${LINK_MINUTES} minutes):\n${url}\n\nOpening the page does not scan anything or run DEEP.`,
};
const FOOTPRINT_LINK: LinkKind = {
  scope: "footprint", path: "/f/", log: "footprint_link", unavailable: "The footprint link is not available right now.",
  message: (url) => `To count this Telegram result in your web scan, open this link (works once, expires in ${LINK_MINUTES} minutes):\n${url}\n\nIt shares which Telegram hexagons were checked, not your values. Opening the page does not scan anything.`,
};

export const handleDashboardCommand = (env: Env, update: unknown, log: Logger): Promise<void> => issueLink(env, update, log, DASHBOARD_LINK);
export const handleFootprintCommand = (env: Env, update: unknown, log: Logger): Promise<void> => issueLink(env, update, log, FOOTPRINT_LINK);

async function issueLink(env: Env, update: unknown, log: Logger, kind: LinkKind): Promise<void> {
  const s = telegramSender(update);
  if (!s || !env.TELEGRAM_BOT_TOKEN) return;
  const say = (text: string) => call(env, "sendMessage", { chat_id: s.chatId, text, link_preview_options: { is_disabled: true } });
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) { log.warn(`${kind.log}_storage_unconfigured`); await say(kind.unavailable); return; }
    const ids = await senderIds(env, s.id);   // gate 3: scans of this person may be stored under the plain id (older) or its HMAC (TELEGRAM_ID_HMAC_KEY set)
    const nowIso = encodeURIComponent(new Date().toISOString());
    const hourAgo = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());
    const recent = await rest(env, "GET", `dashboard_links?select=token_hash&${senderFilter(ids.read)}&created_at=gt.${hourAgo}&limit=${MAX_LINKS_PER_HOUR}`);
    if (!recent.ok) { await say(kind.unavailable); return; }
    if (recent.rows.length >= MAX_LINKS_PER_HOUR) { await say("You have asked for several dashboard links in the last hour. Please use the last one, or try again later."); return; }
    const snap = await rest(env, "GET", `profile_snapshots?select=id,sender_id&${senderFilter(ids.read)}&status=eq.complete&expires_at=gt.${nowIso}&order=created_at.desc&limit=1`);
    if (!snap.ok) { await say(kind.unavailable); return; }
    const snapshotId = snap.rows[0]?.id;
    const rowSender = snap.rows[0]?.sender_id;
    const linkSender = typeof rowSender === "string" ? rowSender : ids.key;   // the link carries the snapshot's own sender key, so the page finds the same rows
    if (typeof snapshotId !== "string") { await say("There is no completed scan to show yet. Say \"scan me\" first."); return; }
    const token = crypto.randomUUID(); // v4, from the runtime CSPRNG; the only identifying value in the link
    const created = new Date();
    const saved = await rest(env, "POST", "dashboard_links", {
      token_hash: await sha256Hex(token), sender_id: linkSender, snapshot_id: snapshotId,
      created_at: created.toISOString(), expires_at: new Date(created.getTime() + LINK_MINUTES * 60_000).toISOString(),
      ...(kind.scope === "footprint" ? { scope: "footprint" } : {}), // dashboard rows stay exactly as before (works before the scope migration)
    }, "return=minimal");
    if (!saved.ok) { log.warn(`${kind.log}_save_failed`); await say(kind.unavailable); return; }
    const sent = await say(kind.message(`${base(env)}${kind.path}${token}`));
    log.info(`${kind.log}_issued`, { sent: sent.status });
  } catch (err) {
    log.warn(`${kind.log}_failed`, { error: err instanceof Error ? err.name : "unknown" });
  }
}
