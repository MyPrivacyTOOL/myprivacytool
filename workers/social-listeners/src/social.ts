// MPC-7628: the X activity feed. Every follow, DM, like, share or mention by a person is one row in public.social_contacts /
// social_events (Supabase), which syncs into HubSpot (the CRM). We keep the platform user id and public @handle only: never message
// text. A "delete my data" DM erases the person (eraseContact). Failures only mean one uncounted event; they never block a reply.
import type { Logger } from "./logger";
import { type Env, pick } from "./shared";
import { deleteFromHubSpot, syncToHubSpot } from "./hubspot-sync";

export type SocialEvent = "dm" | "follow" | "like" | "share" | "mention" | "mirror_consent";

const rpc = async (env: Env, fn: string, body: Record<string, unknown>): Promise<Response | null> => {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  return fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
};

/** Records one activity by a person. `followsUs` is only sent when known. Never throws. */
export async function touchContact(
  env: Env, userId: string, handle: string | undefined, event: SocialEvent, log: Logger, followsUs?: boolean | null,
): Promise<void> {
  if (!/^\d+$/.test(userId)) return;
  try {
    const res = await rpc(env, "mpt_social_touch", {
      p_platform: "x", p_user_id: userId, p_handle: handle ?? null, p_event: event, p_follows_us: followsUs ?? null,
    });
    if (res && !res.ok) log.warn("social_touch_failed", { status: res.status });
    if (!res || res.ok) await syncToHubSpot(env, { userId, handle, event, followsUs }, log); // the CRM copy; skipped without HUBSPOT_SOCIAL_TOKEN
  } catch (err) {
    log.warn("social_touch_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Erases a person and their events. True when something was removed (or nothing was stored). Never throws. */
export async function eraseContact(env: Env, userId: string, log: Logger): Promise<boolean> {
  if (!/^\d+$/.test(userId)) return false;
  try {
    const gone = await deleteFromHubSpot(env, userId, log); // the CRM copy goes too
    const res = await rpc(env, "mpt_erase_social_contact", { p_platform: "x", p_user_id: userId });
    if (res === null) return gone; // nothing is stored in Supabase when it is not configured
    if (!res.ok) log.warn("social_erase_failed", { status: res.status });
    return res.ok && gone;
  } catch (err) {
    log.warn("social_erase_failed", { error: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}

/** "delete" / "delete my data" (any case, punctuation tolerated). */
export const isDeleteRequest = (text: unknown): boolean =>
  typeof text === "string" && /^(please\s+)?delete(\s+(my\s+)?(data|info|details))?$/.test(text.trim().toLowerCase().replace(/[.!\s]+$/g, ""));

export interface Engagement { userId: string; handle?: string; event: Exclude<SocialEvent, "dm" | "mirror_consent"> }

const str = (v: unknown): string | undefined => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

/**
 * Follows, likes, shares and mentions aimed at the account, from the legacy Account Activity shapes (follow_events, favorite_events,
 * tweet_create_events). Our own actions are ignored. Shapes we do not recognise yield nothing (they are logged by describeShape).
 */
export function extractEngagement(payload: unknown, self: string): Engagement[] {
  const out: Engagement[] = [];
  const list = (key: string): unknown[] => {
    const v = pick(payload, key);
    return Array.isArray(v) ? v : [];
  };
  const add = (userId: string | undefined, handle: unknown, event: Engagement["event"]) => {
    if (userId && /^\d+$/.test(userId) && userId !== self) out.push({ userId, handle: typeof handle === "string" ? handle : undefined, event });
  };
  for (const e of list("follow_events")) {
    if (pick(e, "type") === "follow" && str(pick(e, "target", "id")) === self) add(str(pick(e, "source", "id")), pick(e, "source", "screen_name"), "follow");
  }
  for (const e of list("favorite_events")) add(str(pick(e, "user", "id")), pick(e, "user", "screen_name"), "like");
  for (const t of list("tweet_create_events")) {
    const uid = str(pick(t, "user", "id"));
    const rt = pick(t, "retweeted_status", "user", "id") ?? pick(t, "quoted_status", "user", "id");
    const mentions = pick(t, "entities", "user_mentions");
    if (str(rt) === self) add(uid, pick(t, "user", "screen_name"), "share");
    else if (Array.isArray(mentions) && mentions.some((m: unknown) => str(pick(m, "id")) === self)) add(uid, pick(t, "user", "screen_name"), "mention");
  }
  return out;
}
