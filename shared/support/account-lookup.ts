import type { AccountLookup } from "./proof-request";

export interface RestAccountLookupConfig { baseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; restPrefix?: string; timeoutMs?: number; tenantId?: string }

/**
 * Resolves the email address of a customer to their account over PostgREST: `public.users` (id uuid, unique on lower(email);
 * supabase/migrations/20261005120000_scan_report_pipeline.sql). The "subject" of a verified support identity is that `users.id`, the same
 * id `ScansReportStatusReader` filters `scans.user_id` on (decision recorded in MPC-8530, D-3). MPT is single-tenant, so the tenant is the constant "mpt".
 *
 * DORMANT: only `requestProof` calls it, and nothing calls `requestProof` yet. Read-only; selects only `id` and `email`; service_role key.
 * It never returns the address, only the ids, and it throws on any HTTP or shape problem so the caller's background work swallows it
 * (a failure must look exactly like "no account" to the customer).
 *
 * Matching: PostgREST cannot filter on lower(email), so it uses `ilike` with every LIKE metacharacter neutralised, then requires EXACTLY ONE row
 * whose lowercased address equals the lowercased request. An address containing `*`, `%` or `\` is treated as having no account (none of those
 * can match safely through PostgREST's pattern syntax). Two matching rows, or zero, mean "no account": it never guesses between accounts.
 */
export class RestAccountLookup implements AccountLookup {
  constructor(private c: RestAccountLookupConfig) {
    if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) throw new Error("baseUrl must be https (or localhost for tests)");
    if (!c.serviceKey) throw new Error("serviceKey required");
  }
  async findByEmail(email: string): Promise<{ subjectId: string; tenantId: string } | null> {
    const e = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!e || e.length > 255 || /[*%\\\s]/.test(e)) return null;
    const pattern = e.replace(/_/g, "\\_"); // `_` is a single-character wildcard in ILIKE
    const url = `${this.c.baseUrl.replace(/\/$/, "")}${this.c.restPrefix ?? "/rest/v1"}/users?email=ilike.${encodeURIComponent(pattern)}&select=id,email&limit=2`;
    const res = await (this.c.fetchImpl ?? fetch)(url, {
      headers: { apikey: this.c.serviceKey, Authorization: `Bearer ${this.c.serviceKey}` },
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`account lookup failed: ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error("unexpected response");
    const exact = rows.filter((r): r is { id: string; email: string } => !!r && typeof r.id === "string" && typeof r.email === "string" && r.email.trim().toLowerCase() === e);
    if (exact.length !== 1 || !/^[0-9a-f-]{36}$/i.test(exact[0].id)) return null;
    return { subjectId: exact[0].id, tenantId: this.c.tenantId ?? "mpt" };
  }
}
