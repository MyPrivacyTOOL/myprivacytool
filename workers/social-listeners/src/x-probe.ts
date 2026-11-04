// X channel probe (test-only; docs/channel-probe-x.md). With PROBE_MODE=on, an X webhook event from one of OUR OWN test accounts
// (PROBE_X_IDS numeric ids, or PROBE_X_HANDLES) is saved exactly as delivered, then the public lookups OSINT would use are saved raw:
// the user object and the latest public posts. Rows go to public.channel_probe_captures (platform "x", 7 day expiry, service_role only).
// Anyone not on the lists takes the normal path untouched. Mode off (the default) does nothing. Nothing here can change the webhook response.
import type { Logger } from "./logger";
import { extractDms, selfId } from "./mirror-bot";
import { probeMode } from "./probe-reader";
import type { Env } from "./shared";

/** Env plus the two allow-lists: PROBE_X_IDS (numeric X user ids) and PROBE_X_HANDLES (@handles, any case), both comma-separated. */
export type XProbeEnv = Env & { PROBE_X_IDS?: string; PROBE_X_HANDLES?: string };

const X_API = "https://api.x.com/2";
const TIMEOUT_MS = 5000;
// Everything the user object can carry for an app bearer token. If X refuses a field name (400) the documented set is used instead and both answers are saved.
const FULL_USER_FIELDS =
  "created_at,description,entities,id,location,most_recent_tweet_id,name,pinned_tweet_id,profile_banner_url,profile_image_url,protected,public_metrics,receives_your_dm,subscription_type,url,username,verified,verified_type,withheld,connection_status,affiliation,parody";
const SAFE_USER_FIELDS = "created_at,description,entities,id,location,name,pinned_tweet_id,profile_image_url,protected,public_metrics,url,username,verified,withheld";
const POST_FIELDS = "created_at,lang,public_metrics,entities,source,possibly_sensitive,reply_settings,conversation_id,geo";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const csv = (raw: string | undefined): string[] => (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const xAllowedIds = (env: XProbeEnv): Set<string> => new Set(csv(env.PROBE_X_IDS).filter((s) => /^\d{1,20}$/.test(s)));
export const xAllowedHandles = (env: XProbeEnv): Set<string> =>
  new Set(csv(env.PROBE_X_HANDLES).map((s) => s.replace(/^@/, "").toLowerCase()).filter((s) => /^\w{1,15}$/.test(s)));

export interface XActor { id: string; handle?: string }

/** The people an X event is about (DM senders, authors of mentions, new followers, likers), never our own account. */
export function xActors(payload: unknown): XActor[] {
  const p = obj(payload);
  if (!p) return [];
  const self = selfId(payload);
  const users = obj(p.users) ?? {};
  const found = new Map<string, XActor>();
  const add = (id: string | undefined, handle?: string): void => {
    if (!id || id === self || !/^\d{1,20}$/.test(id)) return;
    found.set(id, { id, handle: handle ?? found.get(id)?.handle ?? str(obj(users[id])?.screen_name) });
  };
  for (const e of arr(p.direct_message_events)) add(str(obj(obj(e)?.message_create)?.sender_id));
  for (const d of extractDms(payload)) add(d.senderId);
  for (const e of arr(p.tweet_create_events)) {
    const u = obj(obj(e)?.user);
    add(str(u?.id_str ?? u?.id), str(u?.screen_name));
  }
  for (const e of arr(p.follow_events)) {
    const s = obj(obj(e)?.source);
    add(str(s?.id), str(s?.screen_name));
  }
  for (const e of arr(p.favorite_events)) {
    const u = obj(obj(e)?.user);
    add(str(u?.id_str ?? u?.id), str(u?.screen_name));
  }
  return [...found.values()];
}

export function isXProbeActor(env: XProbeEnv, actor: XActor): boolean {
  return xAllowedIds(env).has(actor.id) || (actor.handle !== undefined && xAllowedHandles(env).has(actor.handle.toLowerCase()));
}

interface Row { platform: string; sender_id: string; kind: string; payload: unknown }
interface Answer { status: number; response: unknown; rate?: { limit: string | null; remaining: string | null; reset: string | null } }

async function save(env: Env, rows: Row[], log: Logger): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return log.warn("probe_storage_unconfigured");
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/channel_probe_captures`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) log.warn("probe_save_failed", { status: res.status });
  } catch (err) {
    log.warn("probe_save_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** One X API read with the app bearer token. Returns what X answered (errors included) so refusals are evidence too. Never throws, never logs the URL. */
async function xGet(env: Env, path: string): Promise<Answer> {
  try {
    const res = await fetch(`${X_API}${path}`, { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let response: unknown = null;
    try { response = await res.json(); } catch { /* non-JSON answer: keep null */ }
    const h = res.headers;
    return { status: res.status, response, rate: { limit: h.get("x-rate-limit-limit"), remaining: h.get("x-rate-limit-remaining"), reset: h.get("x-rate-limit-reset") } };
  } catch (err) {
    return { status: 0, response: { error: err instanceof Error ? err.name : "unknown" } };
  }
}

/** The user object: every field first, the documented fields if X refuses a field name. Both answers are kept. */
async function lookupUser(env: Env, id: string): Promise<Json> {
  const full = await xGet(env, `/users/${id}?user.fields=${FULL_USER_FIELDS}&expansions=pinned_tweet_id&tweet.fields=created_at,text`);
  if (full.status !== 400) return { ...full, fields: "full" };
  const safe = await xGet(env, `/users/${id}?user.fields=${SAFE_USER_FIELDS}`);
  return { ...safe, fields: "safe", full_attempt: full };
}

/** Saves the raw X event and the public lookups for allow-listed accounts only. Never throws. */
export async function runXProbe(env: XProbeEnv, payload: unknown, log: Logger): Promise<void> {
  try {
    if (probeMode(env) !== "on") return;
    if (xAllowedIds(env).size === 0 && xAllowedHandles(env).size === 0) return;
    const actors = xActors(payload).filter((a) => isXProbeActor(env, a));
    if (actors.length === 0) return;
    const rows: Row[] = [];
    for (const a of actors) {
      rows.push({ platform: "x", sender_id: a.id, kind: "update", payload });
      if (!env.X_BEARER_TOKEN) {
        log.warn("probe_x_token_unset");
        continue;
      }
      const [user, posts] = await Promise.all([lookupUser(env, a.id), xGet(env, `/users/${a.id}/tweets?max_results=5&tweet.fields=${POST_FIELDS}`)]);
      rows.push({ platform: "x", sender_id: a.id, kind: "lookup:users", payload: user }, { platform: "x", sender_id: a.id, kind: "lookup:users/tweets", payload: posts });
    }
    await save(env, rows, log);
    log.info("probe_x_captured", { rows: rows.length });
  } catch (err) {
    log.warn("probe_x_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
