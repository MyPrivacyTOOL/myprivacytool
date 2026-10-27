import type { CaseStore } from "./types";
import { RestProofStore } from "./proof";

/**
 * Requesting an identity proof (MPC-8530 decision D-3, approved by Chris 2026-10-27): the customer gives the email address of their account and,
 * if an account exists, a single-use code is emailed to that address. This module is DORMANT: nothing calls it, no route exists, and the two ports below
 * have no production implementation yet. Sending the email is an approval-gated action; wiring this to a route needs the MPC-8531 review first.
 *
 * Properties, each covered by a test:
 *  - No account enumeration. The caller gets the same answer whether or not an account exists, and (because the lookup, issue and send run AFTER the
 *    answer, via `defer`) the same timing. Failures after the answer are swallowed: the only way to learn anything is to own the mailbox.
 *  - Per-address (3/hour) and per-IP (20/hour) limits, counted on EVERY attempt, existing account or not, so the limiter does not leak either.
 *    Counters live in the case store under HASHED keys, so no address or IP is written to support_usage.
 *  - Fails closed: if the limiter cannot be read or written, nothing is looked up and nothing is sent.
 *  - The plaintext token exists only in the email. Its hash is stored (RestProofStore.issue), valid 15 minutes, single use.
 */
export const PROOF_TTL_SECONDS = 900;
export const PROOF_MAX_PER_ADDRESS_PER_HOUR = 3;
export const PROOF_MAX_PER_IP_PER_HOUR = 20;

export interface AccountLookup { findByEmail(email: string): Promise<{ subjectId: string; tenantId: string } | null> }
export interface ProofMailer { send(to: string, subject: string, text: string, idempotencyKey: string): Promise<void> }
export interface ProofIssuer { issue(subjectId: string, tenantId: string, ttlSeconds?: number): Promise<{ token: string; id: string }> }

export interface ProofRequestDeps {
  store: CaseStore;
  accounts: AccountLookup;
  issuer: Pick<RestProofStore, "issue"> | ProofIssuer;
  mailer: ProofMailer;
  /** Hand background work to the runtime (Workers: ctx.waitUntil). It must not be awaited before answering. */
  defer: (work: Promise<unknown>) => void;
  /** Base URL of the page that reads the code from the URL fragment, e.g. "https://myprivacytool.io/support/verify". */
  verifyUrl: string;
  now?: () => Date;
  /** Receives a short reason code only, never an address, IP or token. */
  onBackgroundError?: (reason: string) => void;
}

export type ProofRequestResult = { status: "accepted" | "invalid" | "rate_limited" | "unavailable" };

const EMAIL = /^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,255}$/;
const sha256 = async (s: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

export function buildProofEmail(token: string, verifyUrl: string): { subject: string; text: string } {
  const link = `${verifyUrl.replace(/#.*$/, "")}#${token}`;
  return {
    subject: "Your MyPrivacyTOOL help verification code",
    text:
      `Someone asked to verify this email address for help with a MyPrivacyTOOL report. If that was you, open this link within 15 minutes:\n\n${link}\n\n` +
      `It works once. We will never ask you for a password or a code you receive by text. If you did not ask for this, ignore this email and nothing will happen.`,
  };
}

export async function requestProof(d: ProofRequestDeps, input: { email: unknown; ip?: string }): Promise<ProofRequestResult> {
  const raw = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (raw.length > 254 || !EMAIL.test(raw)) return { status: "invalid" };
  const now = (d.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const addrKey = `proof:addr:${await sha256(raw)}`;
  const ipKey = `proof:ip:${await sha256(input.ip ?? "unknown")}`;
  try {
    const [a, i] = [await d.store.usageSince(addrKey, since), await d.store.usageSince(ipKey, since)];
    if (a.calls >= PROOF_MAX_PER_ADDRESS_PER_HOUR || i.calls >= PROOF_MAX_PER_IP_PER_HOUR) return { status: "rate_limited" };
    // Counted before any lookup and for every attempt, so a hit and a miss consume the limit identically.
    await d.store.recordUsage(addrKey, 1, now.toISOString());
    await d.store.recordUsage(ipKey, 1, now.toISOString());
  } catch {
    return { status: "unavailable" };
  }
  d.defer(
    (async () => {
      try {
        const account = await d.accounts.findByEmail(raw);
        if (!account) return;
        const { token, id } = await d.issuer.issue(account.subjectId, account.tenantId, PROOF_TTL_SECONDS);
        const mail = buildProofEmail(token, d.verifyUrl);
        await d.mailer.send(raw, mail.subject, mail.text, `support-proof-${id}`);
      } catch {
        d.onBackgroundError?.("proof_request_failed");
      }
    })(),
  );
  return { status: "accepted" };
}

export interface ResendProofMailerConfig { apiKey: string; from: string; fetchImpl?: typeof fetch; timeoutMs?: number }
/** Resend, same API contract as ResendNotifier. Throws unless Resend confirms with an id; the caller swallows it (no enumeration). */
export class ResendProofMailer implements ProofMailer {
  constructor(private c: ResendProofMailerConfig) { if (!c.apiKey || !c.from) throw new Error("apiKey and from required"); }
  async send(to: string, subject: string, text: string, idempotencyKey: string): Promise<void> {
    if (!EMAIL.test(to)) throw new Error("invalid address");
    const res = await (this.c.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.c.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: this.c.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    if (!j.id) throw new Error("Resend did not confirm the send");
  }
}
