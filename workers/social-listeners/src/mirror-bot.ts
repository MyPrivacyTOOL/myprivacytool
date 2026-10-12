// MPC-7628: Channel OSINT "MIRROR" bot for X DMs.
// Flow: "MIRROR" -> consent request -> "MIRROR YES" -> public profile scan -> educational mirror DM.
// Retention: none. The consent step is stateless (the explicit "MIRROR YES" message is the consent), the scan result lives
// only in memory for the length of one request, and logs carry event names only (no handles, ids or profile content).
import type { Logger } from "./logger";
import type { Env } from "./shared";

const SCAN_URL = "https://myprivacytool.io/scan";
const X_API = "https://api.x.com/2";
const X_TIMEOUT_MS = 5000;

export type MirrorCommand = "request" | "consent" | "decline" | null;

/** Classifies a DM. Only "MIRROR", "MIRROR YES" and "MIRROR NO" (case/punctuation-insensitive) are commands. */
export function parseMirrorCommand(text: unknown): MirrorCommand {
  if (typeof text !== "string") return null;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words[0] !== "mirror" || words.length > 2) return null;
  if (words.length === 1) return "request";
  if (words[1] === "yes") return "consent";
  if (words[1] === "no") return "decline";
  return null;
}

export interface MirrorDm {
  senderId: string;
  text: string;
  command: Exclude<MirrorCommand, null>;
}

/** MIRROR commands in an Account Activity payload. Our own DM echoes (sender === for_user_id) are never commands. */
export function extractMirrorDms(payload: unknown): MirrorDm[] {
  const p = payload as { for_user_id?: unknown; direct_message_events?: unknown } | null;
  const self = String(p?.for_user_id ?? "");
  const events = Array.isArray(p?.direct_message_events) ? (p!.direct_message_events as any[]) : [];
  const out: MirrorDm[] = [];
  for (const e of events) {
    if (e?.type !== "message_create") continue;
    const senderId = String(e.message_create?.sender_id ?? "");
    const text = e.message_create?.message_data?.text;
    const command = parseMirrorCommand(text);
    if (!senderId || senderId === self || !command) continue;
    out.push({ senderId, text, command });
  }
  return out;
}

export interface XProfile {
  name?: string;
  username?: string;
  description?: string;
  location?: string;
  url?: string;
  created_at?: string;
  protected?: boolean;
  verified?: boolean;
  profile_image_url?: string;
  pinned_tweet_id?: string;
  public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
}

export const CONSENT_MESSAGE =
  "🪞 MyPrivacyTOOL Mirror\n\n" +
  "I can show you what a stranger can see about your X account using only public information.\n\n" +
  "• I read your PUBLIC profile only (bio, location, link, join date, counts).\n" +
  "• I never read your DMs, email, phone, IP or private activity.\n" +
  "• I store nothing: no profile data, no message history. The result is built, sent to you and discarded.\n\n" +
  "To start, reply: MIRROR YES\nTo cancel, reply: MIRROR NO";

export const DECLINE_MESSAGE = "No problem. Nothing was scanned and nothing was stored. Send MIRROR any time to try again.";
export const ERROR_MESSAGE =
  "Sorry, I couldn't complete the scan right now. Nothing was stored. Please try again later by sending MIRROR.";

const yesNo = (b: boolean) => (b ? "visible" : "not set");

/** Builds the educational mirror text from public profile fields only. Pure: no I/O. */
export function buildMirrorMessage(p: XProfile): string {
  const visible: string[] = [];
  if (p.description) visible.push(`• Bio: "${p.description.slice(0, 160)}" (may reveal job, location, interests)`);
  else visible.push(`• Bio: ${yesNo(false)}`);
  visible.push(p.location ? `• Location: "${p.location}" (self-declared, public)` : `• Location: ${yesNo(false)}`);
  visible.push(p.url ? `• Link: ${p.url} (can connect you to other accounts or sites)` : `• Link: ${yesNo(false)}`);
  if (p.created_at) visible.push(`• Account created: ${p.created_at.slice(0, 10)} (shows how long you've had this identity)`);
  const m = p.public_metrics;
  if (m) visible.push(`• Counts: ${m.followers_count ?? "?"} followers, ${m.following_count ?? "?"} following, ${m.tweet_count ?? "?"} posts`);
  visible.push("• Profile photo and display name (usable for reverse-image and name searches)");
  if (p.pinned_tweet_id) visible.push("• A pinned post anyone can open");

  const head = p.protected
    ? "Your account is PROTECTED, so your posts are hidden, but the profile basics above are still public."
    : "Your account is PUBLIC, so anyone can also read your posts, replies and likes-by-others.";

  return (
    "🪞 Your Mirror (public information only)\n\n" +
    `${head}\n\nWhat anyone can see:\n${visible.join("\n")}\n\n` +
    "What stays protected (I never saw it): your DMs, email address, phone number, IP address, login history and who you message.\n\n" +
    "Why it matters: combining small public details is how people get profiled, doxxed or targeted by scams.\n\n" +
    `Next step: run a free full scan at ${SCAN_URL}\n\n` +
    "I stored nothing from this scan. Your data was discarded when this message was sent."
  );
}

async function xFetch(env: Env, path: string, init: RequestInit & { token: string }): Promise<Response> {
  const { token, ...rest } = init;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), X_TIMEOUT_MS);
  try {
    return await fetch(`${X_API}${path}`, {
      ...rest,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(rest.headers ?? {}) },
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Public-profile lookup by user id with an app bearer token. Null on any failure. */
export async function fetchPublicProfile(env: Env, userId: string): Promise<XProfile | null> {
  if (!env.X_BEARER_TOKEN || !/^\d+$/.test(userId)) return null;
  const fields = "name,username,description,location,url,created_at,protected,verified,profile_image_url,pinned_tweet_id,public_metrics";
  const res = await xFetch(env, `/users/${userId}?user.fields=${fields}`, { method: "GET", token: env.X_BEARER_TOKEN });
  if (!res.ok) return null;
  return ((await res.json()) as { data?: XProfile }).data ?? null;
}

/** Sends a DM with the user-context token (dm.write). Returns whether X accepted it. */
export async function sendXDm(env: Env, recipientId: string, text: string): Promise<boolean> {
  if (!env.X_USER_ACCESS_TOKEN || !/^\d+$/.test(recipientId)) return false;
  const res = await xFetch(env, `/dm_conversations/with/${recipientId}/messages`, {
    method: "POST",
    token: env.X_USER_ACCESS_TOKEN,
    body: JSON.stringify({ text }),
  });
  return res.ok;
}

/** Handles one MIRROR command end to end. Never throws; logs event names only. */
export async function handleMirrorDm(env: Env, dm: MirrorDm, log: Logger): Promise<void> {
  try {
    if (dm.command === "request") {
      log.info("mirror_consent_requested");
      await sendXDm(env, dm.senderId, CONSENT_MESSAGE);
      return;
    }
    if (dm.command === "decline") {
      log.info("mirror_consent_declined");
      await sendXDm(env, dm.senderId, DECLINE_MESSAGE);
      return;
    }
    log.info("mirror_consent_granted");
    const profile = await fetchPublicProfile(env, dm.senderId);
    if (!profile) {
      log.warn("mirror_scan_failed");
      await sendXDm(env, dm.senderId, ERROR_MESSAGE);
      return;
    }
    log.info("mirror_scan_complete");
    const sent = await sendXDm(env, dm.senderId, buildMirrorMessage(profile));
    log.info(sent ? "mirror_delivered" : "mirror_delivery_failed");
  } catch (err) {
    log.error("mirror_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
