import type { Channel, Identity, Verifier } from "./types";

/** 32 random bytes, base64url. The plaintext exists only in the email sent to the account holder; only its hash is stored. */
export function newProofToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function hashProof(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** A well-formed token is exactly what newProofToken() makes. Anything else is rejected before any database call. */
export const isProofToken = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);

export interface ProofStoreConfig { baseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; restPrefix?: string; timeoutMs?: number }

/**
 * Issues and redeems hashed, single-use proofs over PostgREST (SQL functions in supabase/migrations/20261027140000_mpc_8528_support_cases.sql).
 * ISSUING IS NOT WIRED to any endpoint or email: looking up an account by email and sending a message is an approval-gated action.
 * Whoever wires it must answer identically whether or not the account exists (no account enumeration) and rate-limit per address.
 */
export class RestProofStore {
  constructor(private c: ProofStoreConfig) {
    if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) throw new Error("baseUrl must be https (or localhost for tests)");
    if (!c.serviceKey) throw new Error("serviceKey required");
  }
  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await (this.c.fetchImpl ?? fetch)(`${this.c.baseUrl.replace(/\/$/, "")}${this.c.restPrefix ?? "/rest/v1"}/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.c.serviceKey, Authorization: `Bearer ${this.c.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args), signal: AbortSignal.timeout(this.c.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`proof ${fn} failed: ${res.status}`);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  /** Returns the plaintext token to deliver out of band. ttl is bounded 60..3600s by the database. */
  async issue(subjectId: string, tenantId: string, ttlSeconds = 600): Promise<{ token: string; id: string }> {
    const token = newProofToken();
    const id = await this.rpc("support_issue_proof", { p_token_hash: await hashProof(token), p_subject: subjectId, p_tenant: tenantId, p_ttl_seconds: ttlSeconds });
    if (typeof id !== "string") throw new Error("proof not issued");
    return { token, id };
  }
  /** Single use: the identity is returned once, then null for the same token, an expired one, or an unknown one. */
  async redeem(token: string): Promise<{ subjectId: string; tenantId: string } | null> {
    if (!isProofToken(token)) return null;
    const r = (await this.rpc("support_redeem_proof", { p_token_hash: await hashProof(token) })) as { subject_id?: string; tenant_id?: string } | null;
    return r?.subject_id && r.tenant_id ? { subjectId: r.subject_id, tenantId: r.tenant_id } : null;
  }
}

/**
 * The only path to `verified`. A well-formed unredeemed proof yields the subject and tenant it was issued for; anything else
 * (missing, malformed, used, expired, unknown) is not verified. Errors propagate so resolveIdentity() fails closed.
 */
export class ProofVerifier implements Verifier {
  constructor(private store: RestProofStore) {}
  async resolve(proof: string | undefined, _channel: Channel, _senderHandle?: string): Promise<Identity> {
    if (!isProofToken(proof)) return { level: "anonymous" };
    const r = await this.store.redeem(proof);
    return r ? { level: "verified", subjectId: r.subjectId, tenantId: r.tenantId } : { level: "anonymous" };
  }
}
