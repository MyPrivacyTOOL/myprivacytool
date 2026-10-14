// MPC-7628: the X activity feed. Every follow, DM, like, share or mention by a person is one row in public.social_contacts /
// social_events (Supabase), which syncs into HubSpot (the CRM). We keep the platform user id and public @handle only: never message
// text. A "delete my data" DM erases the person (eraseContact). Failures only mean one uncounted event; they never block a reply.
import type { Logger } from "./logger";
import type { Env } from "./shared";

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
  } catch (err) {
    log.warn("social_touch_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Erases a person and their events. True when something was removed (or nothing was stored). Never throws. */
export async function eraseContact(env: Env, userId: string, log: Logger): Promise<boolean> {
  if (!/^\d+$/.test(userId)) return false;
  try {
    const res = await rpc(env, "mpt_erase_social_contact", { p_platform: "x", p_user_id: userId });
    if (res === null) return true; // nothing is stored when Supabase is not configured
    if (!res.ok) log.warn("social_erase_failed", { status: res.status });
    return res.ok;
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
  const p = payload as any;
  const out: Engagement[] = [];
  const add = (userId: string | undefined, handle: unknown, event: Engagement["event"]) => {
    if (userId && /^\d+$/.test(userId) && userId !== self) out.push({ userId, handle: typeof handle === "string" ? handle : undefined, event });
  };
  for (const e of Array.isArray(p?.follow_events) ? p.follow_events : []) {
    if (e?.type === "follow" && str(e?.target?.id) === self) add(str(e?.source?.id), e?.source?.screen_name, "follow");
  }
  for (const e of Array.isArray(p?.favorite_events) ? p.favorite_events : []) add(str(e?.user?.id), e?.user?.screen_name, "like");
  for (const t of Array.isArray(p?.tweet_create_events) ? p.tweet_create_events : []) {
    const uid = str(t?.user?.id);
    const rt = t?.retweeted_status?.user?.id ?? t?.quoted_status?.user?.id;
    if (str(rt) === self) add(uid, t?.user?.screen_name, "share");
    else if (Array.isArray(t?.entities?.user_mentions) && t.entities.user_mentions.some((m: any) => str(m?.id) === self)) add(uid, t?.user?.screen_name, "mention");
  }
  return out;
}
