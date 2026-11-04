import type { DueFollowup, FollowupStore } from "./followup-worker";

export interface RestFollowupConfig {
  baseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** "/rest/v1" for Supabase (default); "" for a standalone PostgREST (CI). */
  restPrefix?: string;
}

type Row = Record<string, unknown>;

/**
 * FollowupStore over PostgREST rpc/ calls to the MPC-8529 SQL functions. Fail-closed like RestCaseStore: a non-2xx, timeout or
 * unexpected body THROWS, so the worker leaves the lease to expire and never records a success it did not get.
 */
export class RestFollowupStore implements FollowupStore {
  private f: typeof fetch;
  constructor(private c: RestFollowupConfig) {
    if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) throw new Error("baseUrl must be https (or localhost for tests)");
    if (!c.serviceKey) throw new Error("serviceKey required");
    this.f = c.fetchImpl ?? fetch;
  }
  private async call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<unknown> {
    const res = await this.f(`${this.c.baseUrl.replace(/\/$/, "")}${this.c.restPrefix ?? "/rest/v1"}/${path}`, {
      method,
      headers: { apikey: this.c.serviceKey, Authorization: `Bearer ${this.c.serviceKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`followup store ${path.split("?")[0]} failed: ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async claimDue(owner: string, limit: number, leaseSeconds: number): Promise<DueFollowup[]> {
    const rows = (await this.call("rpc/support_followup_claim_due", { p_owner: owner, p_limit: limit, p_lease_seconds: leaseSeconds })) as Row[];
    if (!Array.isArray(rows)) throw new Error("unexpected claim response");
    return rows.map((r) => ({
      caseId: r.case_id as string, nextActionKind: (r.next_action_kind as string) ?? null,
      attemptCount: r.attempt_count as number, maxAttempts: r.max_attempts as number,
    }));
  }
  async recordAttempt(caseId: string, key: string, kind: string, outcome: "attempted" | "delivered" | "failed", receipt: string | null, messageId: string | null) {
    const r = await this.call("rpc/support_followup_record_attempt", { p_case: caseId, p_key: key, p_kind: kind, p_outcome: outcome, p_receipt: receipt, p_message: messageId });
    if (r !== "recorded" && r !== "duplicate" && r !== "terminal") throw new Error("unexpected attempt response");
    return r;
  }
  async markDelivered(key: string, receipt: string) {
    const r = await this.call("rpc/support_followup_mark_delivered", { p_key: key, p_receipt: receipt });
    if (typeof r !== "boolean") throw new Error("unexpected receipt response");
    return r;
  }
  async hasUnconfirmedAttempt(caseId: string, kind: string, sinceIso: string) {
    const q = encodeURIComponent;
    const rows = (await this.call(`support_followup_attempt?case_id=eq.${q(caseId)}&kind=eq.${q(kind)}&outcome=eq.attempted&attempted_at=gte.${q(sinceIso)}&limit=1&select=idempotency_key`)) as Row[];
    if (!Array.isArray(rows)) throw new Error("unexpected attempt lookup response");
    return rows.length > 0;
  }
}
