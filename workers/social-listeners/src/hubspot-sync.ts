// MPC-7628: pushes an X person into HubSpot (the CRM) right after the Supabase feed records them, so no scheduled job is needed
// (the Cloudflare free plan is at its cron limit). Uses a dedicated private-app token (HUBSPOT_SOCIAL_TOKEN) that can only touch
// contacts. The contact carries the X user id, public @handle, whether they follow us, and what they did last: never message text.
// Skipped silently when the token is not set. Every failure is logged by name and never blocks a reply.
import type { Logger } from "./logger";
import type { Env } from "./shared";

const API = "https://api.hubapi.com";
const MISSING = (v?: string) => !v || v === "placeholder";

const PROPERTIES = [
  { name: "x_user_id", label: "X user id", type: "string", fieldType: "text", hasUniqueValue: true },
  { name: "x_handle", label: "X handle", type: "string", fieldType: "text" },
  { name: "x_last_event", label: "X last activity type", type: "string", fieldType: "text" },
  { name: "x_last_activity", label: "X last activity", type: "datetime", fieldType: "date" },
  { name: "x_follows_us", label: "Follows us on X", type: "bool", fieldType: "booleancheckbox", options: [{ label: "Yes", value: "true", displayOrder: 0 }, { label: "No", value: "false", displayOrder: 1 }] },
];

let propertiesReady = false;
/** Test hook. */
export function resetHubSpotCache(): void {
  propertiesReady = false;
}

export const hubspotEnabled = (env: Env): boolean => !MISSING(env.HUBSPOT_SOCIAL_TOKEN);

const call = (env: Env, path: string, method: string, body?: unknown): Promise<Response> =>
  fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.HUBSPOT_SOCIAL_TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });

/** Creates the custom contact properties once per isolate. An existing property (409) is fine. False when it cannot be done. */
async function ensureProperties(env: Env, log: Logger): Promise<boolean> {
  if (propertiesReady) return true;
  for (const p of PROPERTIES) {
    const res = await call(env, "/crm/v3/properties/contacts", "POST", { ...p, groupName: "contactinformation" });
    if (!res.ok && res.status !== 409) {
      log.warn("hubspot_property_failed", { status: res.status, name: p.name }); // 403 = the token lacks crm.schemas.contacts.write
      return false;
    }
  }
  propertiesReady = true;
  return true;
}

/** The HubSpot contact id for an X user id, or null. */
async function findContact(env: Env, userId: string): Promise<string | null> {
  const res = await call(env, "/crm/v3/objects/contacts/search", "POST", {
    filterGroups: [{ filters: [{ propertyName: "x_user_id", operator: "EQ", value: userId }] }],
    limit: 1,
  });
  if (!res.ok) throw new Error(`search_${res.status}`);
  const id = ((await res.json()) as { results?: { id?: string }[] }).results?.[0]?.id;
  return id ? String(id) : null;
}

export interface HubSpotContact { userId: string; handle?: string; event: string; followsUs?: boolean | null }

/** Creates or updates the person in HubSpot, then marks the Supabase row as synced. Never throws. */
export async function syncToHubSpot(env: Env, c: HubSpotContact, log: Logger): Promise<void> {
  if (!hubspotEnabled(env)) return;
  try {
    if (!(await ensureProperties(env, log))) return;
    const properties: Record<string, string> = { x_user_id: c.userId, x_last_event: c.event, x_last_activity: new Date().toISOString() };
    if (c.handle) properties.x_handle = c.handle;
    if (c.followsUs !== undefined && c.followsUs !== null) properties.x_follows_us = String(c.followsUs);
    const existing = await findContact(env, c.userId);
    const res = existing
      ? await call(env, `/crm/v3/objects/contacts/${existing}`, "PATCH", { properties })
      : await call(env, "/crm/v3/objects/contacts", "POST", { properties: { ...properties, firstname: c.handle ? `@${c.handle}` : "X user", lastname: "(X)" } });
    if (!res.ok) return void log.warn("hubspot_sync_failed", { status: res.status });
    log.info(existing ? "hubspot_contact_updated" : "hubspot_contact_created");
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/social_contacts?platform=eq.x&platform_user_id=eq.${c.userId}`, {
        method: "PATCH",
        headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ hubspot_synced_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(3000),
      });
    }
  } catch (err) {
    log.warn("hubspot_sync_failed", { error: err instanceof Error ? err.message.slice(0, 40) : "unknown" });
  }
}

/** "Delete my data": removes the person from HubSpot too. True when gone (or never there / not configured). Never throws. */
export async function deleteFromHubSpot(env: Env, userId: string, log: Logger): Promise<boolean> {
  if (!hubspotEnabled(env)) return true;
  try {
    const id = await findContact(env, userId);
    if (!id) return true;
    const res = await call(env, `/crm/v3/objects/contacts/${id}`, "DELETE");
    if (!res.ok && res.status !== 404) log.warn("hubspot_delete_failed", { status: res.status });
    return res.ok || res.status === 404;
  } catch (err) {
    log.warn("hubspot_delete_failed", { error: err instanceof Error ? err.message.slice(0, 40) : "unknown" });
    return false;
  }
}
