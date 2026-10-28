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

/** Where an event came from, as the platform reported it (CK-8502). All optional: DMs and older shapes carry none. */
export interface EventOrigin {
  /** The platform's own id for the event, or a key built from its fields. A redelivery with the same key changes nothing. */
  eventKey?: string;
  /** Platform timestamp in ms. */
  occurredAt?: number;
  /** Id of the public post the event relates to (a tweet id), never text. */
  sourceRef?: string;
}

/** Events older than this are not recorded: a platform replay (or an attacker's replay of a captured delivery) cannot resurrect a person who has since asked to be erased. */
export const EVENT_MAX_AGE_MS = 72 * 3600_000;
export const isStale = (occurredAt: number | undefined, now = Date.now()): boolean => occurredAt !== undefined && Number.isFinite(occurredAt) && now - occurredAt > EVENT_MAX_AGE_MS;

/** Records one activity by a person. `followsUs` is only sent when known. Never throws. Uses the idempotent database function when it exists (CK-8502), else the old one. */
export async function touchContact(
  env: Env, userId: string, handle: string | undefined, event: SocialEvent, log: Logger, followsUs?: boolean | null, origin: EventOrigin = {},
): Promise<void> {
  if (!/^\d+$/.test(userId)) return;
  if (isStale(origin.occurredAt)) return void log.info("social_event_stale", { event });
  try {
    const base = { p_platform: "x", p_user_id: userId, p_handle: handle ?? null, p_event: event, p_follows_us: followsUs ?? null };
    let res = await rpc(env, "mpt_social_record", {
      ...base, p_event_key: origin.eventKey ?? null, p_source_ref: origin.sourceRef ?? null,
      p_occurred_at: origin.occurredAt !== undefined && Number.isFinite(origin.occurredAt) ? new Date(origin.occurredAt).toISOString() : null,
    });
    let duplicate = false;
    if (res && res.status === 404) res = await rpc(env, "mpt_social_touch", base); // migration not applied yet: old behaviour
    else if (res?.ok) duplicate = ((await res.json().catch(() => null)) as { duplicate?: boolean } | null)?.duplicate === true;
    if (res && !res.ok) log.warn("social_touch_failed", { status: res.status });
    if (duplicate) return void log.info("social_event_duplicate", { event });
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

export interface Engagement extends EventOrigin { userId: string; handle?: string; event: Exclude<SocialEvent, "dm" | "mirror_consent"> }

/**
 * Funnel stage an event proves (CK-8502). Only what the platform actually showed us: a follow/like/share/mention is ENGAGEMENT by a platform
 * identity; a DM is a PROSPECT who wrote to us; a MIRROR consent is a SCAN REQUEST. TRAFFIC (anonymous clicks, aggregate follower counts)
 * is never a contact and has no entry here: nothing in this Worker turns it into one.
 */
export type FunnelStage = "engagement" | "prospect" | "scan_request";
export const stageOf = (event: SocialEvent): FunnelStage => (event === "dm" ? "prospect" : event === "mirror_consent" ? "scan_request" : "engagement");

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
  const ms = (v: unknown): number | undefined => { const n = Number(str(v)); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const add = (userId: string | undefined, handle: unknown, event: Engagement["event"], origin: EventOrigin = {}) => {
    if (userId && /^\d+$/.test(userId) && userId !== self) out.push({ userId, handle: typeof handle === "string" ? handle : undefined, event, ...origin });
  };
  for (const e of list("follow_events")) {
    if (pick(e, "type") === "follow" && str(pick(e, "target", "id")) === self) {
      const who = str(pick(e, "source", "id")), at = str(pick(e, "created_timestamp"));
      add(who, pick(e, "source", "screen_name"), "follow", { eventKey: at ? `follow:${who}:${at}` : undefined, occurredAt: ms(at) });
    }
  }
  for (const e of list("favorite_events")) {
    const who = str(pick(e, "user", "id")), post = str(pick(e, "favorited_status", "id_str")), id = str(pick(e, "id"));
    add(who, pick(e, "user", "screen_name"), "like", { eventKey: id ? `like:${id}` : post ? `like:${who}:${post}` : undefined, occurredAt: ms(pick(e, "timestamp_ms")), sourceRef: post });
  }
  for (const t of list("tweet_create_events")) {
    const uid = str(pick(t, "user", "id")), tid = str(pick(t, "id_str"));
    const rt = pick(t, "retweeted_status", "user", "id") ?? pick(t, "quoted_status", "user", "id");
    const mentions = pick(t, "entities", "user_mentions");
    const at = ms(pick(t, "timestamp_ms"));
    if (str(rt) === self) add(uid, pick(t, "user", "screen_name"), "share", { eventKey: tid ? `share:${tid}` : undefined, occurredAt: at, sourceRef: str(pick(t, "retweeted_status", "id_str")) ?? str(pick(t, "quoted_status", "id_str")) });
    else if (Array.isArray(mentions) && mentions.some((m: unknown) => str(pick(m, "id")) === self)) add(uid, pick(t, "user", "screen_name"), "mention", { eventKey: tid ? `mention:${tid}` : undefined, occurredAt: at, sourceRef: str(pick(t, "in_reply_to_status_id_str")) ?? tid });
  }
  return out;
}
