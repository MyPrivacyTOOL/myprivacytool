// MPC-7628: Channel OSINT "MIRROR" bot for X DMs.
// Flow: "MIRROR" -> consent request -> "MIRROR YES" -> public profile scan -> educational mirror DM.
// Retention: none. The consent step is stateless (the explicit "MIRROR YES" message is the consent), the scan result lives
// only in memory for the length of one request, and logs carry event names only (no handles, ids or profile content).
import type { Logger } from "./logger";
import type { Env } from "./shared";
import { getUserAccessToken } from "./x-oauth";

// Tagging convention for channel bots (MPC-7641): utm_source=<platform>&utm_medium=channel_osint&utm_campaign=bot_reply.
const SCAN_URL = "https://myprivacytool.io/scan?utm_source=x&utm_medium=channel_osint&utm_campaign=bot_reply";
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

/**
 * A bare answer to the consent question: any form of yes (y, Y, yes, yeah, yep, yup, in any case, punctuation ignored) or, quietly,
 * any form of no. Only counts when our last DM to the sender was the consent request. The consent message only asks for the yes.
 */
export function parseBareReply(text: unknown): "consent" | "decline" | null {
  if (typeof text !== "string") return null;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length !== 1) return null;
  if (/^(y|ye|yes+|yeah|yea|yep|yup)$/.test(words[0])) return "consent";
  if (/^(n|no|nope)$/.test(words[0])) return "decline";
  return null;
}

export interface MirrorDm {
  senderId: string;
  text: string;
  command: Exclude<MirrorCommand, null>;
  /** True for a bare Y/N: not yet known to answer our consent request, check with isConsentPending before acting. */
  bare?: true;
}

const MAX_DEPTH = 8;

/** The id of the account the event was delivered for (our bot), from either event system. */
export function selfId(p: any): string {
  return String(p?.for_user_id ?? p?.data?.filter?.user_id ?? p?.filter?.user_id ?? p?.data?.payload?.filter?.user_id ?? "");
}

/** Sender id and text of one DM-shaped object, in the shapes X uses (legacy Account Activity and the newer dm.received event). */
function dmFields(o: any): { sender: string; text: string } | null {
  const sender = o.sender_id ?? o.sender?.id ?? o.from_user_id;
  const text = o.text ?? o.message_data?.text ?? (typeof o.message === "string" ? o.message : o.message?.text) ?? o.dm_event?.text;
  if ((typeof sender !== "string" && typeof sender !== "number") || typeof text !== "string") return null;
  return { sender: String(sender), text };
}

/**
 * MIRROR commands in an X webhook payload. Walks the JSON for DM-shaped objects so both the legacy Account Activity shape
 * (direct_message_events[].message_create) and the newer dm.received shape are understood. Our own echoes (sender == the
 * account the event was delivered for) are never commands.
 */
export function extractMirrorDms(payload: unknown): MirrorDm[] {
  const out: MirrorDm[] = [];
  for (const { senderId, text } of extractDms(payload)) {
    const command = parseMirrorCommand(text);
    const bare = command ? null : parseBareReply(text);
    if (command) out.push({ senderId, text, command });
    else if (bare) out.push({ senderId, text, command: bare, bare: true });
  }
  return out;
}

/** Every inbound DM (any text) in an X webhook payload, own echoes excluded, duplicates collapsed. */
export function extractDms(payload: unknown): { senderId: string; text: string }[] {
  const self = selfId(payload);
  const out: { senderId: string; text: string }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const f = dmFields(node);
    if (f && f.sender !== self && f.text.trim()) {
      const key = `${f.sender}|${f.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ senderId: f.sender, text: f.text });
      }
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(payload, 0);
  return out;
}

/** Event type and top-level key names only (no ids, no text), so an unrecognised event shape can be diagnosed from logs. */
export function describeShape(payload: unknown): { event_type?: string; keys: string[] } {
  const p = payload as any;
  const raw = p?.event_type ?? p?.data?.event_type ?? p?.payload?.event_type;
  const event_type = typeof raw === "string" && /^[a-z0-9_.]{1,48}$/i.test(raw) ? raw : undefined;
  const keys = p && typeof p === "object" ? Object.keys(p).filter((k) => /^[a-z0-9_]{1,40}$/i.test(k)).slice(0, 12) : [];
  return event_type ? { event_type, keys } : { keys };
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
  "To start, just reply Y.";

/** First line of CONSENT_MESSAGE: how a later bare Y/N is recognised as answering it. */
const CONSENT_MARKER = CONSENT_MESSAGE.split("\n")[0];
const CONSENT_WINDOW_MS = 15 * 60_000;

/** MPC-7628: answer to any other DM, sent straight away. No LLM, nothing stored. */
export const WELCOME_MESSAGE =
  "👋 Welcome to MyPrivacyTOOL. I'm an automated assistant, so I can't chat, but I can help in two ways:\n\n" +
  "• Reply MIRROR for a free look at what your public X profile reveals. I ask for your OK first, and nothing is stored.\n" +
  `• Or run our free privacy scan: ${SCAN_URL}`;

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

/** Calls X with the user-context token. Refreshes the token and retries once on 401. Null when no token can be had. */
async function xUser(env: Env, log: Logger, path: string, init: RequestInit): Promise<Response | null> {
  for (const force of [false, true]) {
    const token = await getUserAccessToken(env, log, force);
    if (!token) return null;
    const res = await xFetch(env, path, { ...init, token });
    if (res.status !== 401) return res;
  }
  return null;
}

/** Sends a DM with the user-context token (dm.write). Returns whether X accepted it. */
export async function sendXDm(env: Env, recipientId: string, text: string, log?: Logger): Promise<boolean> {
  if (!/^\d+$/.test(recipientId)) return false;
  const quiet: Logger = log ?? { info() {}, warn() {}, error() {} };
  const res = await xUser(env, quiet, `/dm_conversations/with/${recipientId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  return Boolean(res?.ok);
}

/** Per-sender and global limits on Mirror commands: each scan spends X API credits. Fails open when no binding is configured. */
async function allowed(env: Env, senderId: string, log: Logger): Promise<boolean> {
  for (const [name, limiter, key] of [
    ["sender", env.RATE_LIMITER, `x:${senderId}`],
    ["global", env.RATE_LIMITER_GLOBAL, "x-mirror"],
  ] as const) {
    if (!limiter) continue;
    try {
      if (!(await limiter.limit({ key })).success) {
        log.warn("mirror_rate_limited", { scope: name });
        return false;
      }
    } catch {
      /* fail open */
    }
  }
  return true;
}

/**
 * Is this sender answering our consent request? Stateless: asks X for the last few DMs in this conversation (nothing is stored on
 * our side) and checks that OUR most recent message to them is the consent request, sent within the last 15 minutes. Rate limited
 * like any Mirror command because the lookup costs X credits. False on any failure, so the message is then handled as ordinary.
 */
export async function isConsentPending(env: Env, senderId: string, selfId: string, log: Logger): Promise<boolean> {
  if (!/^\d+$/.test(senderId) || !selfId) return false;
  if (!(await allowed(env, senderId, log))) return false;
  try {
    const res = await xUser(env, log, `/dm_conversations/with/${senderId}/dm_events?max_results=5&event_types=MessageCreate&dm_event.fields=created_at,sender_id,text`, { method: "GET" });
    if (!res?.ok) return false;
    const events = ((await res.json()) as { data?: { sender_id?: string; text?: string; created_at?: string }[] }).data ?? [];
    const mine = events.find((e) => String(e.sender_id) === selfId); // X lists newest first
    return Boolean(mine?.text?.startsWith(CONSENT_MARKER) && Date.now() - Date.parse(mine.created_at ?? "") < CONSENT_WINDOW_MS);
  } catch {
    return false;
  }
}

/** Handles one MIRROR command end to end. Never throws; logs event names only. */
export async function handleMirrorDm(env: Env, dm: MirrorDm, log: Logger): Promise<void> {
  try {
    if (!dm.bare && !(await allowed(env, dm.senderId, log))) return; // dropped silently: replying would cost credits too (bare replies were limited by isConsentPending)
    if (dm.command === "request") {
      log.info("mirror_consent_requested");
      await sendXDm(env, dm.senderId, CONSENT_MESSAGE, log);
      return;
    }
    if (dm.command === "decline") {
      log.info("mirror_consent_declined");
      await sendXDm(env, dm.senderId, DECLINE_MESSAGE, log);
      return;
    }
    log.info("mirror_consent_granted");
    const profile = await fetchPublicProfile(env, dm.senderId);
    if (!profile) {
      log.warn("mirror_scan_failed");
      await sendXDm(env, dm.senderId, ERROR_MESSAGE, log);
      return;
    }
    log.info("mirror_scan_complete");
    const sent = await sendXDm(env, dm.senderId, buildMirrorMessage(profile), log);
    log.info(sent ? "mirror_delivered" : "mirror_delivery_failed");
  } catch (err) {
    log.error("mirror_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Replies to a DM that is not a Mirror command. Same per-sender / global limits as Mirror, so it cannot be used to flood. */
export async function handleOrdinaryDm(env: Env, dm: { senderId: string }, log: Logger): Promise<void> {
  if (!(await allowed(env, dm.senderId, log))) return;
  const sent = await sendXDm(env, dm.senderId, WELCOME_MESSAGE, log);
  log.info(sent ? "welcome_sent" : "welcome_failed");
}
