// MPC-7628: Channel OSINT "MIRROR" bot for X DMs.
// Flow: "MIRROR" -> consent request -> "MIRROR YES" -> public profile scan -> educational mirror DM.
// Retention: none. The consent step is stateless (the explicit "MIRROR YES" message is the consent), the scan result lives
// only in memory for the length of one request, and logs carry event names only (no handles, ids or profile content).
import type { Logger } from "./logger";
import { type Env, pick } from "./shared";
import { getUserAccessToken } from "./x-oauth";
import { uploadDmVideo } from "./x-media";
import { classifyTheme, recordXDm } from "./funnel";
import { eraseContact, touchContact } from "./social";

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
export function selfId(p: unknown): string {
  return String(pick(p, "for_user_id") ?? pick(p, "data", "filter", "user_id") ?? pick(p, "filter", "user_id") ?? pick(p, "data", "payload", "filter", "user_id") ?? "");
}

/** Sender id and text of one DM-shaped object, in the shapes X uses (legacy Account Activity and the newer dm.received event). */
function dmFields(o: unknown): { sender: string; text: string } | null {
  const sender = pick(o, "sender_id") ?? pick(o, "sender", "id") ?? pick(o, "from_user_id");
  const message = pick(o, "message");
  const text = pick(o, "text") ?? pick(o, "message_data", "text") ?? (typeof message === "string" ? message : pick(o, "message", "text")) ?? pick(o, "dm_event", "text");
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
  const p = payload;
  const raw = pick(p, "event_type") ?? pick(p, "data", "event_type") ?? pick(p, "payload", "event_type");
  const event_type = typeof raw === "string" && /^[a-z0-9_.]{1,48}$/i.test(raw) ? raw : undefined;
  const keys = p && typeof p === "object" ? Object.keys(p as object).filter((k) => /^[a-z0-9_]{1,40}$/i.test(k)).slice(0, 12) : [];
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
  "• I keep none of your profile data or messages: the result is built, sent to you and discarded. I only note that you got in touch (your @handle and the date). Send DELETE any time and I'll remove it.\n\n" +
  "To start, just reply Y.";

/** The heading inside the consent request: how a later bare Y/N is recognised as answering it (the greeting comes before it). */
const CONSENT_MARKER = CONSENT_MESSAGE.split("\n")[0];
const CONSENT_WINDOW_MS = 15 * 60_000;

/** One-tap follow (X's own follow intent page). A reply cannot make someone follow us, so we link it. */
export const FOLLOW_LINE = "👉 Follow @MyPrivacyTOOL for privacy alerts: https://x.com/intent/follow?screen_name=MyPrivacyTOOL";

/** Every message we send opens with who we are (so it is easy to find in the inbox and remembered as the brand) and ends with the same signature. */
export const SIGNATURE = "— @MyPrivacyTOOL · myprivacytool.io";
export const greeting = (username?: string): string => `Hello${username ? ` @${username}` : ""}, this is @MyPrivacyTOOL 👋`;
export const branded = (username: string | undefined, body: string): string => `${greeting(username)}\n\n${body}\n\n${SIGNATURE}`;

/**
 * The Mirror offer used in the welcome and the follow-ups: a plain "reply Y". It names exactly what is read, and its heading is the
 * same CONSENT_MARKER as the full consent request, so a bare Y right after any of them counts as consent (see isConsentPending).
 */
const MIRROR_OFFER =
  `${CONSENT_MARKER}: reply Y and I'll show you what anyone can see on your PUBLIC X profile. I never read your DMs and keep none of your profile data.`;

/** MPC-7628: answer to any other DM, sent straight away. No LLM. Asks what brought them here so the next step fits. */
export const WELCOME_BODY =
  "We show you what the internet can learn about you, and how to take control of it. I'm an automated assistant.\n\n" +
  "What brought you here? Reply 1, 2 or 3, or tell us in your own words:\n" +
  "1. I'm curious what's out there about me\n" +
  "2. I'm worried about something specific\n" +
  "3. I'm just exploring\n\n" +
  `${MIRROR_OFFER}\n` +
  `🔎 Or run the free privacy scan: ${SCAN_URL}\n\n` +
  `${FOLLOW_LINE}\n\n` +
  "Privacy: I only note that you got in touch (your @handle, never what you write). Send DELETE and I'll remove it.\n\n" +
  "Thank you for getting in touch.";
export const WELCOME_MESSAGE = branded(undefined, WELCOME_BODY);

/** Replies to "1" / "2" / "3". Only the number is logged (aggregate counts), never who sent it. */
export const INTENT_REPLIES: Record<string, string> = {
  "1":
    "Thank you, that's exactly what we're here for.\n\n" +
    `${MIRROR_OFFER}\n` +
    `🔎 Or run the free scan to see what your browser, device and email reveal: ${SCAN_URL}`,
  "2":
    "Thank you for telling me, and I'm sorry you're dealing with that. If you feel unsafe, please contact your local authorities first.\n\n" +
    `🔎 To see what about you is exposed and get step-by-step fixes, run the free scan: ${SCAN_URL}\n` +
    MIRROR_OFFER,
  "3":
    "Welcome! MyPrivacyTOOL shows you what's visible about you online, explains why it matters in plain language, and walks you through taking it back.\n\n" +
    `${MIRROR_OFFER}\n` +
    `🔎 Or start with the free scan: ${SCAN_URL}`,
};

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
      // A FormData body (media upload) needs the runtime to set its own multipart Content-Type.
      headers: { Authorization: `Bearer ${token}`, ...(rest.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(rest.headers ?? {}) },
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

/** Public @handle for a user id (app bearer token), or undefined: the greeting then simply leaves the handle out. */
export async function fetchUsername(env: Env, userId: string): Promise<string | undefined> {
  if (!/^\d+$/.test(userId) || !env.X_BEARER_TOKEN) return undefined;
  try {
    const res = await xFetch(env, `/users/${userId}?user.fields=username`, { method: "GET", token: env.X_BEARER_TOKEN });
    const u = res.ok ? ((await res.json()) as { data?: { username?: unknown } }).data?.username : undefined;
    return typeof u === "string" && /^\w{1,15}$/.test(u) ? u : undefined;
  } catch {
    return undefined;
  }
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

/** Whether this person follows the account (user token, connection_status). Null when it cannot be told. */
export async function fetchFollowsUs(env: Env, userId: string, log: Logger): Promise<boolean | null> {
  if (!/^\d+$/.test(userId)) return null;
  try {
    const res = await xUser(env, log, `/users/${userId}?user.fields=connection_status`, { method: "GET" });
    if (!res?.ok) return null;
    const cs = ((await res.json()) as { data?: { connection_status?: unknown } }).data?.connection_status;
    return Array.isArray(cs) ? cs.includes("followed_by") : null;
  } catch {
    return null;
  }
}

/** Notes the activity in the CRM feed after the reply is out (so it never delays the reply). */
async function noteContact(env: Env, senderId: string, handle: string | undefined, event: "dm" | "mirror_consent", log: Logger): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
  await touchContact(env, senderId, handle, event, log, await fetchFollowsUs(env, senderId, log));
}

/**
 * Sends a DM with the user-context token (dm.write). Returns whether X accepted it.
 * With `video`, the Alice clip is attached; if it cannot be uploaded (or X refuses the attachment) the text goes alone.
 */
export async function sendXDm(env: Env, recipientId: string, text: string, log?: Logger, opts: { video?: boolean } = {}): Promise<boolean> {
  if (!/^\d+$/.test(recipientId)) return false;
  const quiet: Logger = log ?? { info() {}, warn() {}, error() {} };
  const path = `/dm_conversations/with/${recipientId}/messages`;
  if (opts.video) {
    const mediaId = await uploadDmVideo(env, quiet, (p, init) => xUser(env, quiet, p, init));
    if (mediaId) {
      const withVideo = await xUser(env, quiet, path, { method: "POST", body: JSON.stringify({ text, attachments: [{ media_id: mediaId }] }) });
      if (withVideo?.ok) return true;
      quiet.warn("x_dm_video_rejected", { status: withVideo?.status ?? 0 });
    }
  }
  const res = await xUser(env, quiet, path, { method: "POST", body: JSON.stringify({ text }) });
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
    return Boolean(mine?.text?.includes(CONSENT_MARKER) && Date.now() - Date.parse(mine.created_at ?? "") < CONSENT_WINDOW_MS);
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
      await recordXDm(env, "help", "x.mirror.request", log);
      const handle = await fetchUsername(env, dm.senderId);
      await sendXDm(env, dm.senderId, branded(handle, CONSENT_MESSAGE), log);
      await noteContact(env, dm.senderId, handle, "dm", log);
      return;
    }
    if (dm.command === "decline") {
      log.info("mirror_consent_declined");
      await recordXDm(env, "help", "x.mirror.decline", log);
      const handle = await fetchUsername(env, dm.senderId);
      await sendXDm(env, dm.senderId, branded(handle, DECLINE_MESSAGE), log);
      await noteContact(env, dm.senderId, handle, "dm", log);
      return;
    }
    log.info("mirror_consent_granted");
    await recordXDm(env, "scan", "x.mirror.consent", log); // the Mirror is a scan: counts as a scan request in the funnel
    const profile = await fetchPublicProfile(env, dm.senderId);
    if (!profile) {
      log.warn("mirror_scan_failed");
      await sendXDm(env, dm.senderId, branded(await fetchUsername(env, dm.senderId), ERROR_MESSAGE), log);
      return;
    }
    log.info("mirror_scan_complete");
    const sent = await sendXDm(env, dm.senderId, branded(profile.username, "Thank you for saying yes.\n\n" + buildMirrorMessage(profile) + `\n\n${FOLLOW_LINE}`), log, { video: true });
    log.info(sent ? "mirror_delivered" : "mirror_delivery_failed");
    await noteContact(env, dm.senderId, profile.username, "mirror_consent", log);
  } catch (err) {
    log.error("mirror_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Replies to a DM that is not a Mirror command. Same per-sender / global limits as Mirror, so it cannot be used to flood. */
export async function handleOrdinaryDm(env: Env, dm: { senderId: string; text?: string }, log: Logger): Promise<void> {
  if (!(await allowed(env, dm.senderId, log))) return;
  const choice = dm.text?.trim().replace(/[.!)]$/, "");
  const reply = choice && /^[123]$/.test(choice) ? INTENT_REPLIES[choice] : undefined;
  // Funnel row: the number they chose, or the theme of what they typed. Never the text, never who sent it.
  await recordXDm(env, "help", reply ? `x.intent.${choice}` : `x.welcome.${classifyTheme(dm.text ?? "")}`, log);
  const username = await fetchUsername(env, dm.senderId);
  const sent = await sendXDm(env, dm.senderId, reply ? branded(username, reply + "\n\nThank you!") : branded(username, WELCOME_BODY), log, { video: true });
  log.info(sent ? "welcome_sent" : "welcome_failed");
  await noteContact(env, dm.senderId, username, "dm", log);
}

/** "Delete my data": removes the person from the CRM feed and says so. Rate limited like every DM we answer. */
export async function handleDeleteDm(env: Env, dm: { senderId: string }, log: Logger): Promise<void> {
  if (!(await allowed(env, dm.senderId, log))) return;
  const done = await eraseContact(env, dm.senderId, log);
  log.info(done ? "contact_erased" : "contact_erase_failed");
  const username = await fetchUsername(env, dm.senderId);
  await sendXDm(
    env, dm.senderId,
    branded(username, done ? "Done. I've removed your @handle and our record of your activity. We now hold nothing about you from X." : "Sorry, I couldn't remove that just now. Please send DELETE again in a few minutes."),
    log,
  );
}
