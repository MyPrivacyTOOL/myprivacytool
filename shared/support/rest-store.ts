import type { ActionReceipt, CaseMessage, CaseStore, Channel, DeliveryStatus, InboundEvent, SupportCase } from "./types";

export interface RestStoreConfig {
  /** Supabase project URL, e.g. https://<ref>.supabase.co. Never the live project from tests. */
  baseUrl: string;
  /** service_role key. The support_* tables grant nothing to anon/authenticated. */
  serviceKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Path prefix of the REST API. Supabase serves PostgREST under /rest/v1 (the default); a standalone PostgREST (CI) serves at the root: "". */
  restPrefix?: string;
}

type Row = Record<string, unknown>;
const q = encodeURIComponent;

const toCase = (r: Row): SupportCase => ({
  id: r.id as string, ref: r.ref as string, channel: r.channel as Channel,
  threadKey: (r.thread_key as string) ?? undefined, senderHandle: (r.sender_handle as string) ?? undefined,
  state: r.state as SupportCase["state"], stateReason: (r.state_reason as string) ?? undefined,
  identityLevel: r.identity_level as SupportCase["identityLevel"], linkedSubjectId: (r.linked_subject_id as string) ?? undefined,
  tenantId: (r.tenant_id as string) ?? undefined, policyVersion: r.policy_version as string,
  knowledgeVersion: (r.knowledge_version as string) ?? undefined, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  reopenCount: r.reopen_count as number,
});
const toMessage = (r: Row): CaseMessage => ({
  id: r.id as string, caseId: r.case_id as string, direction: r.direction as CaseMessage["direction"],
  providerEventId: (r.provider_event_id as string) ?? undefined, text: r.body as string, author: r.author as CaseMessage["author"],
  at: r.created_at as string, delivery: (r.delivery as DeliveryStatus) ?? undefined,
});
const toReceipt = (r: Row): ActionReceipt => ({
  id: r.id as string, caseId: r.case_id as string, tool: r.tool as string, idempotencyKey: r.idempotency_key as string,
  policyVersion: r.policy_version as string, outcome: r.outcome as ActionReceipt["outcome"], detail: (r.detail as string) ?? undefined,
  costUnits: r.cost_units as number, at: r.created_at as string,
});
const CASE_COLS: Record<string, string> = {
  state: "state", stateReason: "state_reason", identityLevel: "identity_level", linkedSubjectId: "linked_subject_id",
  tenantId: "tenant_id", knowledgeVersion: "knowledge_version", reopenCount: "reopen_count",
};

/**
 * CaseStore over Supabase PostgREST (Workers have fetch, not a Postgres driver). Fail-closed: any non-2xx, network error,
 * timeout or unexpected body THROWS, so intake answers "not recorded" and never returns a reference without a confirmed write.
 * Atomic intake and dedupe live in the SQL functions of supabase/migrations/20261027140000_mpc_8528_support_cases.sql.
 */
export class RestCaseStore implements CaseStore {
  private f: typeof fetch;
  constructor(private c: RestStoreConfig) {
    if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) throw new Error("baseUrl must be https (or localhost for tests)");
    if (!c.serviceKey) throw new Error("serviceKey required");
    this.f = c.fetchImpl ?? fetch;
  }

  private async call(method: string, path: string, body?: unknown, prefer?: string): Promise<unknown> {
    const res = await this.f(`${this.c.baseUrl.replace(/\/$/, "")}${this.c.restPrefix ?? "/rest/v1"}/${path}`, {
      method,
      headers: {
        apikey: this.c.serviceKey, Authorization: `Bearer ${this.c.serviceKey}`, "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`support store ${method} ${path.split("?")[0]} failed: ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  private async one(path: string): Promise<Row | null> {
    const rows = (await this.call("GET", path)) as Row[];
    if (!Array.isArray(rows)) throw new Error("unexpected response");
    return rows[0] ?? null;
  }

  async createCaseFromEvent(ev: InboundEvent, init: { ref: string; policyVersion: string; now: string }) {
    const r = (await this.call("POST", "rpc/support_create_case_from_event", {
      p_channel: ev.channel, p_event_id: ev.providerEventId, p_thread_key: ev.threadKey ?? null, p_sender: ev.senderHandle ?? null,
      p_text: ev.text, p_ref: init.ref, p_policy: init.policyVersion,
    })) as { case?: Row; duplicate?: boolean };
    if (!r?.case || typeof r.duplicate !== "boolean") throw new Error("unexpected intake response");
    return { case: toCase(r.case), duplicate: r.duplicate };
  }
  async findCaseByThread(channel: Channel, threadKey: string) {
    const r = await this.one(`support_cases?channel=eq.${q(channel)}&thread_key=eq.${q(threadKey)}&limit=1`);
    return r ? toCase(r) : null;
  }
  async appendInbound(caseId: string, ev: InboundEvent) {
    const dup = await this.call("POST", "rpc/support_append_inbound", { p_case_id: caseId, p_event_id: ev.providerEventId, p_text: ev.text });
    if (typeof dup !== "boolean") throw new Error("unexpected append response");
    return { duplicate: dup };
  }
  async getCase(id: string) { const r = await this.one(`support_cases?id=eq.${q(id)}&limit=1`); return r ? toCase(r) : null; }
  async getCaseByRef(ref: string) { const r = await this.one(`support_cases?ref=eq.${q(ref)}&limit=1`); return r ? toCase(r) : null; }
  async updateCase(id: string, patch: Parameters<CaseStore["updateCase"]>[1], now: string) {
    const body: Row = { updated_at: now };
    for (const [k, v] of Object.entries(patch)) if (k in CASE_COLS) body[CASE_COLS[k]] = v ?? null;
    const rows = (await this.call("PATCH", `support_cases?id=eq.${q(id)}`, body, "return=representation")) as Row[];
    if (!Array.isArray(rows) || !rows[0]) throw new Error("case not updated");
    return toCase(rows[0]);
  }
  async addOutbound(caseId: string, text: string, author: "ai" | "system", now: string) {
    const rows = (await this.call("POST", "support_messages", { case_id: caseId, direction: "outbound", author, body: text, delivery: "queued", created_at: now }, "return=representation")) as Row[];
    if (!Array.isArray(rows) || !rows[0]) throw new Error("outbound not stored");
    return toMessage(rows[0]);
  }
  async setDelivery(messageId: string, status: DeliveryStatus) {
    await this.call("PATCH", `support_messages?id=eq.${q(messageId)}`, { delivery: status });
  }
  async getReceipt(caseId: string, key: string) {
    const r = await this.one(`support_action_receipts?case_id=eq.${q(caseId)}&idempotency_key=eq.${q(key)}&limit=1`);
    return r ? toReceipt(r) : null;
  }
  async putReceipt(r: Omit<ActionReceipt, "id">) {
    const rows = (await this.call("POST", "support_action_receipts?on_conflict=case_id,idempotency_key", {
      case_id: r.caseId, tool: r.tool, idempotency_key: r.idempotencyKey, policy_version: r.policyVersion, outcome: r.outcome,
      detail: r.detail ?? null, cost_units: r.costUnits, created_at: r.at,
    }, "resolution=merge-duplicates,return=representation")) as Row[];
    if (!Array.isArray(rows) || !rows[0]) throw new Error("receipt not stored");
    return toReceipt(rows[0]);
  }
  async usageSince(key: string, sinceIso: string) {
    const rows = (await this.call("GET", `support_usage?usage_key=eq.${q(key)}&at=gte.${q(sinceIso)}&select=cost_units&limit=1000`)) as { cost_units: number }[];
    if (!Array.isArray(rows)) throw new Error("unexpected response");
    return { calls: rows.length, costUnits: rows.reduce((a, b) => a + b.cost_units, 0) };
  }
  async recordUsage(key: string, costUnits: number, at: string) {
    await this.call("POST", "support_usage", { usage_key: key, cost_units: costUnits, at });
  }
}
