// MPC-10621: is this session's sender one of the bot's allow-listed test accounts? Answers a boolean only; the list and the ids never leave the server.
// Same list the bot reads (PROBE_TELEGRAM_IDS, comma-separated numeric ids) and the same stored-key rule as workers/social-listeners/src/sender-key.ts:
// the plain id, or "h1:" + hex HMAC-SHA256 of "telegram:<id>" when TELEGRAM_ID_HMAC_KEY (32+ characters) is set.
import type { DashboardEnv } from "./store";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function isAllowListedSender(env: DashboardEnv, senderId: string): Promise<boolean> {
  try {
    const ids = (env.PROBE_TELEGRAM_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,20}$/.test(s));
    if (!ids.length) return false;
    if (ids.includes(senderId)) return true;
    const secret = env.TELEGRAM_ID_HMAC_KEY;
    if (!secret || secret.length < 32 || !senderId.startsWith("h1:")) return false;
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    for (const id of ids) if (`h1:${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`telegram:${id}`)))}` === senderId) return true;
    return false;
  } catch {
    return false; // never a claim we cannot back: treated as a real user
  }
}
