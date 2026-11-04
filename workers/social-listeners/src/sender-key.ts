// MPC-7894 gate 3: how a Telegram sender id is stored in the scan tables (profile_snapshots, fix_wizard_items, dashboard_links/sessions).
// TELEGRAM_ID_HMAC_KEY unset (default): the plain numeric id, exactly as before (test accounts). Set (at least 32 characters): "h1:" + the hex HMAC-SHA256
// of "telegram:<id>" under that secret, so the database never holds a real person's Telegram id in those key columns. A set but too-short key is a
// misconfiguration and throws: it never falls back to storing the plain id. Reads also accept the plain id, so test-account rows written before the key
// was set stay reachable; writes always use the current key. Telegram API calls and core-brain's own table (conversation_states) always use the plain id.
// Not covered: conversation_states (core-brain, plain id by design; STOP deletes it), the raw getChat answer's other fields (username, name, bio),
// and the PROBE_MODE logs.
import type { Env } from "./shared";

const MIN_KEY_LENGTH = 32;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const hashingEnabled = (env: Env): boolean => !!env.TELEGRAM_ID_HMAC_KEY;

export interface SenderIds { plain: string; key: string; read: string[] }

/** The value stored in sender_id columns for this Telegram id. Throws if a key is set but unusable. */
export async function senderKey(env: Env, id: string): Promise<string> {
  const secret = env.TELEGRAM_ID_HMAC_KEY;
  if (!secret) return id;
  if (secret.length < MIN_KEY_LENGTH) throw new Error("sender key misconfigured");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `h1:${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`telegram:${id}`)))}`;
}

export async function senderIds(env: Env, plain: string): Promise<SenderIds> {
  const key = await senderKey(env, plain);
  return { plain, key, read: key === plain ? [plain] : [key, plain] };
}

/** PostgREST filter for a sender_id column: eq for one value, in.(...) for the key plus the legacy plain id. */
export const senderFilter = (keys: string[]): string =>
  keys.length === 1 ? `sender_id=eq.${keys[0]}` : `sender_id=in.(${keys.map((k) => `%22${k}%22`).join(",")})`;

/** With hashing on, drops the numeric Telegram id from a stored getChat answer. Other fields are unchanged. */
export function redactStoredId<T>(answer: T, env: Env): T {
  if (!hashingEnabled(env)) return answer;
  const a = answer as { response?: { result?: Record<string, unknown> } } | null;
  const result = a?.response?.result;
  if (!result || typeof result !== "object" || !("id" in result)) return answer;
  const { id: _id, ...rest } = result;
  void _id;
  return { ...(answer as object), response: { ...(a!.response as object), result: rest } } as T;
}
