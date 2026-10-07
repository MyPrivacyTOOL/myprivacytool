// MPC-8302: move a lead from "new" to "risk_aware" in public.conversation_states (CK-006 table).
// Talks to PostgREST with the service-role key (table is service_role only). One conditional PATCH:
// `state=eq.new` makes it idempotent and stops a replayed message from demoting a lead who is already further along.

import { createLogger, type Logger } from "@mpt/utils";

export const STATE_NEW = "new";
export const STATE_RISK_AWARE = "risk_aware";

export type Channel = "web" | "email" | "sms" | "whatsapp" | "telegram";
export type TransitionResult = "advanced" | "unchanged" | "error";

export interface StateDeps {
  supabaseUrl: string;
  supabaseKey: string;            // service role (SUPABASE_KEY, see SECRETS.md)
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = new Set<string>(["web", "email", "sms", "whatsapp", "telegram"]);

export async function advanceToRiskAware(leadId: string, channel: Channel, deps: StateDeps): Promise<TransitionResult> {
  const log = deps.logger ?? createLogger("conversation-state");
  if (!UUID_RE.test(leadId) || !CHANNELS.has(channel)) { log.warn("state.invalid_args"); return "error"; }  // also keeps the query string safe
  const url = `${deps.supabaseUrl.replace(/\/$/, "")}/rest/v1/conversation_states?lead_id=eq.${leadId}&channel=eq.${channel}&state=eq.${STATE_NEW}`;
  try {
    const res = await (deps.fetchImpl ?? fetch)(url, {
      method: "PATCH",
      headers: {
        apikey: deps.supabaseKey, authorization: `Bearer ${deps.supabaseKey}`,
        "content-type": "application/json", prefer: "return=representation",
      },
      body: JSON.stringify({ state: STATE_RISK_AWARE, last_message_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) { log.error("state.update_failed", { status: res.status }); return "error"; }
    const rows = (await res.json()) as unknown[];
    log.info("state.transition", { channel, from: STATE_NEW, to: STATE_RISK_AWARE, changed: rows.length });
    return rows.length > 0 ? "advanced" : "unchanged";   // 0 rows: already past "new", or no row for this lead/channel
  } catch (e) {
    log.error("state.update_error", { error: (e as Error)?.name });
    return "error";
  }
}
