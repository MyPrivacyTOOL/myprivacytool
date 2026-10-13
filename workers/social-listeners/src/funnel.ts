// MPC-7628 / MPC-7641: counts X DMs in the Channel OSINT funnel without keeping anything about the person.
// One row per inbound DM in public.interaction_log via mpt_brain_record: channel "x", NO sender id (log-only), NO message text,
// just an intent bucket and an event key, kept 90 days. This is why the Mirror can still promise to store nothing about you.
import type { Logger } from "./logger";
import type { Env } from "./shared";

export type FunnelIntent = "scan" | "help" | "unknown";

/** Coarse theme of a free-text message, by keyword. Only the theme word is ever recorded, never the text. */
export function classifyTheme(text: string): string {
  const t = text.toLowerCase();
  if (/(stalk|harass|doxx|threat|being followed|abus|unsafe)/.test(t)) return "safety";
  if (/(scam|fraud|phish|hacked|hack|stolen|impersonat|fake)/.test(t)) return "scam";
  if (/(leak|breach|exposed|password|data broker|removed? my)/.test(t)) return "exposure";
  if (/(company|business|team|enterprise|partner|press|api|invest)/.test(t)) return "business";
  if (/(curious|what.*(know|out there|find)|about me|privacy)/.test(t)) return "curious";
  return "other";
}

/** Records one inbound DM. Never throws, never logs a value; a failure only means one uncounted DM. */
export async function recordXDm(env: Env, intent: FunnelIntent, key: string, log: Logger): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/mpt_brain_record`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_channel: "x",
        p_sender_id: null,
        p_intent: intent,
        p_intent_source: "rules",
        p_response_key: key,
        p_new_state: null,
        p_trust_floor: 0,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) log.warn("funnel_record_failed", { status: res.status });
  } catch (err) {
    log.warn("funnel_record_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
