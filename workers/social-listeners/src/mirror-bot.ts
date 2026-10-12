// MPC-7628: Channel OSINT bot MVP on X. A user DMs "MIRROR"; the bot asks for consent, reads the public profile of that
// same account only, and DMs back an educational "mirror" of what anyone can see without logging in.
//
// No-data-retention guarantee (enforced here, stated to the user in the consent DM):
//   - the scan result is built in memory and sent; it is never written anywhere;
//   - the only thing stored is a short-lived marker keyed by an HMAC of the sender id (never the id itself):
//     "pending" for CONSENT_TTL_S while we wait for YES/NO, then "cooldown" for COOLDOWN_S to stop repeat scans;
//   - logs carry event names only: no ids, handles, message text or profile fields.
import type { Logger } from "./logger";
import { type Env, base64, hmacSha256 } from "./shared";

export const CONSENT_TTL_S = 600;
export const COOLDOWN_S = 60; // Workers KV minimum TTL
const X_API = "https://api.x.com/2";
const SCAN_URL = "https://myprivacytool.io/scan";
const API_TIMEOUT_MS = 5000;

const MIRROR = /^\s*mirror[\s.!]*$/i;
const YES = /^\s*(y|yes|yep|yeah|i consent|consent)[\s.!]*$/i;
const NO = /^\s*(n|no|nope|nah|cancel|stop)[\s.!]*$/i;

export interface MirrorStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Everything the bot needs to read a profile (app bearer) and DM back (OAuth 1.0a user context). */
export function mirrorConfigured(env: Env): boolean {
  return !!(env.X_CONSUMER_SECRET && env.X_BEARER_TOKEN && env.X_API_KEY && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET);
}

// ---- storage: Workers KV when MIRROR_KV is bound, else the Cache API (no namespace to create; per data centre) ----

function kvStore(kv: NonNullable<Env["MIRROR_KV"]>): MirrorStore {
  return {
    get: (k) => kv.get(k),
    put: (k, v, ttl) => kv.put(k, v, { expirationTtl: Math.max(60, ttl) }),
    delete: (k) => kv.delete(k),
  };
}

function cacheStore(): MirrorStore {
  const req = (k: string) => new Request(`https://mirror.invalid/${k}`);
  return {
    get: async (k) => (await (caches as unknown as { default: Cache }).default.match(req(k)))?.text() ?? null,
    put: async (k, v, ttl) => {
      await (caches as unknown as { default: Cache }).default.put(req(k), new Response(v, { headers: { "Cache-Control": `max-age=${ttl}` } }));
    },
    delete: async (k) => { await (caches as unknown as { default: Cache }).default.delete(req(k)); },
  };
}

export const storeFor = (env: Env): MirrorStore => (env.MIRROR_KV ? kvStore(env.MIRROR_KV) : cacheStore());

async function senderKey(env: Env, senderId: string): Promise<string> {
  const mac = await hmacSha256(env.X_CONSUMER_SECRET ?? "", `mirror:${senderId}`);
  return "mirror:" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- inbound parsing ----

export interface Dm { senderId: string; text: string }

/** The first DM that someone else sent to the bot. Ignores our own echoes and events with no text. */
export function parseDm(payload: unknown): Dm | null {
  const p = payload as { for_user_id?: unknown; direct_message_events?: unknown } | null;
  const events: unknown[] = Array.isArray(p?.direct_message_events) ? (p!.direct_message_events as unknown[]) : [];
  for (const ev of events as any[]) {
    const mc = ev?.type === "message_create" ? ev.message_create : null;
    const senderId = mc?.sender_id, text = mc?.message_data?.text;
    if (typeof senderId !== "string" || typeof text !== "string" || !text.trim()) continue;
    if (senderId === String(p?.for_user_id ?? "")) continue;
    return { senderId, text };
  }
  return null;
}

// ---- copy ----

export const CONSENT_DM =
  "Mirror: see what strangers can see about you on X.\n\n" +
  "If you reply YES, I will read the public profile of THIS account only (name, handle, bio, location, link, join date, follower counts) " +
  "and DM you what it shows. Nothing from your DMs, nothing from other accounts.\n\n" +
  "I do not keep anything: the result is sent to you and never stored, and I only remember that you were asked for 10 minutes. " +
  "Reply YES to continue or NO to cancel.";

export const DECLINED_DM = "No problem. I looked up nothing and I keep nothing. DM MIRROR any time if you change your mind.";
export const COOLDOWN_DM = "I just ran a mirror for this account. Give it a minute, then DM MIRROR again.";
export const UNAVAILABLE_DM = "I could not read the public profile just now, and I kept nothing. Please try MIRROR again in a few minutes.";

export interface PublicProfile {
  name?: string; username?: string; description?: string; location?: string; url?: string; created_at?: string;
  verified?: boolean; protected?: boolean; profile_image_url?: string; pinned_tweet_id?: string;
  public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number; listed_count?: number };
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;

/** Pure: builds the mirror DM from public profile fields. Reads the fields; never stores or logs them. */
export function buildMirrorMessage(p: PublicProfile): string {
  const visible: string[] = [];
  const add = (label: string, value: string | number | undefined | null) => { if (value !== undefined && value !== null && value !== "") visible.push(`- ${label}: ${value}`); };
  add("Name", p.name);
  add("Handle", p.username ? `@${p.username}` : undefined);
  add("Bio", p.description);
  add("Location (as you typed it)", p.location);
  add("Link", p.url);
  add("Joined", p.created_at ? p.created_at.slice(0, 10) : undefined);
  const m = p.public_metrics;
  if (m) add("Counts", `${m.followers_count ?? 0} followers, ${m.following_count ?? 0} following, ${m.tweet_count ?? 0} posts`);
  if (p.profile_image_url && !/default_profile/.test(p.profile_image_url)) visible.push("- A profile photo");

  const notes: string[] = [];
  if (p.description && (EMAIL.test(p.description) || PHONE.test(p.description))) notes.push("Your bio contains what looks like an email or phone number. Anyone can copy it.");
  if (p.location) notes.push("Your location field is free text. If it is a real place, it ties this account to somewhere.");
  if (p.url) notes.push("Your link lets people jump from this account to another site about you.");
  if (p.protected) notes.push("Your posts are protected, so strangers cannot read them. The profile above is still public.");
  else notes.push("Your posts are public, so what you write and when is readable by anyone, and it can be searched.");

  return [
    "Here is your mirror: what anyone can see about this account without logging in.",
    "",
    "VISIBLE TO ANYONE",
    visible.length ? visible.join("\n") : "- Very little. Nothing beyond the handle.",
    "",
    "WORTH A SECOND LOOK",
    notes.map((n) => `- ${n}`).join("\n"),
    "",
    "NOT VISIBLE FROM THIS ACCOUNT",
    "- Your DMs, your email and phone on file with X, and your login history. Only you and X can see those.",
    "",
    "This only covers X. Data brokers hold records that never appear on your profile. See what they hold: " + SCAN_URL,
    "",
    "I did not store any of this. This message is the only copy.",
  ].join("\n");
}

// ---- X API ----

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}

const FIELDS = "name,username,description,location,url,created_at,verified,protected,profile_image_url,pinned_tweet_id,public_metrics";

/** Public profile of the DM sender (app-only bearer: sees only what a logged-out visitor sees). Null on any failure. */
export async function fetchPublicProfile(env: Env, userId: string): Promise<PublicProfile | null> {
  if (!/^\d{1,20}$/.test(userId)) return null;
  const res = await fetchWithTimeout(`${X_API}/users/${userId}?user.fields=${FIELDS}`, { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { data?: PublicProfile }).data ?? null;
}

const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a (HMAC-SHA1) Authorization header. JSON bodies are not part of the signature base. */
export async function oauth1Header(
  method: string, url: string, creds: { key: string; secret: string; token: string; tokenSecret: string },
  nonce = crypto.randomUUID().replace(/-/g, ""), timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.key, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp, oauth_token: creds.token, oauth_version: "1.0",
  };
  const normalized = Object.keys(params).sort().map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`).join("&");
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(normalized)].join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${rfc3986(creds.secret)}&${rfc3986(creds.tokenSecret)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base))));
  const header = { ...params, oauth_signature: sig };
  return "OAuth " + Object.keys(header).sort().map((k) => `${rfc3986(k)}="${rfc3986(header[k as keyof typeof header])}"`).join(", ");
}

export async function sendDm(env: Env, recipientId: string, text: string): Promise<boolean> {
  const url = `${X_API}/dm_conversations/with/${recipientId}/messages`;
  const auth = await oauth1Header("POST", url, {
    key: env.X_API_KEY!, secret: env.X_CONSUMER_SECRET!, token: env.X_ACCESS_TOKEN!, tokenSecret: env.X_ACCESS_TOKEN_SECRET!,
  });
  const res = await fetchWithTimeout(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  return res.ok;
}

// ---- the flow ----

/**
 * Handles one verified X webhook payload. Returns true when the DM belongs to the mirror flow (the caller must not forward
 * it to core-brain), false to let the existing routing carry on. Never throws: a failed API call is logged by event name only.
 */
export async function handleMirrorDm(
  payload: unknown, env: Env, log: Logger, store: MirrorStore = storeFor(env),
  defer: (work: Promise<unknown>) => Promise<void> = (w) => w.then(() => undefined),
): Promise<boolean> {
  if (!mirrorConfigured(env)) return false;
  const dm = parseDm(payload);
  if (!dm) return false;
  const isMirror = MIRROR.test(dm.text);
  const isYes = YES.test(dm.text), isNo = NO.test(dm.text);
  if (!isMirror && !isYes && !isNo) return false;

  const key = await senderKey(env, dm.senderId);
  const marker = await store.get(key);
  const reply = async (text: string) => {
    try { if (!(await sendDm(env, dm.senderId, text))) log.error("mirror_dm_rejected"); }
    catch (err) { log.error("mirror_dm_failed", { error: err instanceof Error ? err.name : "unknown" }); }
  };

  if (isMirror) {
    if (marker === "cooldown") { await defer(reply(COOLDOWN_DM)); return true; }
    await store.put(key, "pending", CONSENT_TTL_S);
    log.info("mirror_consent_requested");
    await defer(reply(CONSENT_DM));
    return true;
  }
  if (marker !== "pending") return false; // a bare YES/NO with nothing pending belongs to the normal Y/N flow

  await store.delete(key); // consent is single-use
  if (isNo) { log.info("mirror_declined"); await defer(reply(DECLINED_DM)); return true; }

  await store.put(key, "cooldown", COOLDOWN_S);
  log.info("mirror_consent_given");
  await defer((async () => {
    let message = UNAVAILABLE_DM;
    try {
      const profile = await fetchPublicProfile(env, dm.senderId);
      if (profile) message = buildMirrorMessage(profile);
      else log.warn("mirror_profile_unavailable");
    } catch (err) {
      log.error("mirror_scan_failed", { error: err instanceof Error ? err.name : "unknown" });
    }
    await reply(message);
    log.info("mirror_delivered");
  })());
  return true;
}
