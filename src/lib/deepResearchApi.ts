import { SCAN_API_URL } from "@/lib/webScan";
import { recipientFetch } from "@/lib/recipientClient";

// MPC-9546/9549: client for the Deep Research ownership check (workers/scan-report/lib/deepResearch.js).
// OFF unless VITE_DEEP_RESEARCH is exactly "true"; the Worker has its own switch (DEEP_RESEARCH_ENABLED), so both must be on.
// Nothing here is stored: the proof of ownership (token) lives in page state only and lasts an hour.
export const deepResearchEnabled = (): boolean => import.meta.env.VITE_DEEP_RESEARCH === "true";

export interface DeepFinding {
  id: string;
  hexagon_id: string;
  finding_type: string;
  confidence_score: number;
  remediation_link: string | null;
  created_at: string;
}

// A flat shape on purpose: this project compiles without strictNullChecks, where a true/false union does not narrow.
// When ok is false, `data` is not there and `error` (and sometimes `status`) say why.
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: string;
}
const fail = <T>(error: string, status?: string): ApiResult<T> => ({ ok: false, error, status });

const FALLBACK = "Something went wrong. Please try again.";

async function post<T>(path: string, body: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<ApiResult<T>> {
  try {
    const res = await recipientFetch("scan-report", `${SCAN_API_URL.replace(/\/$/, "")}/api/deep-research/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }, ["email"], fetchImpl ? { fetchImpl } : {});
    const json = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string; status?: string }) | null;
    if (!res.ok || !json || json.ok === false) {
      return fail<T>(typeof json?.error === "string" ? json.error : FALLBACK, typeof json?.status === "string" ? json.status : undefined);
    }
    return { ok: true, data: json as T };
  } catch {
    return fail<T>("We could not reach the server. Please try again.");
  }
}

/** Sends a six-digit code to the address. The same answer comes back whether or not an email was sent. */
export const startCheck = (email: string, turnstileToken: string, fetchImpl?: typeof fetch) =>
  post<{ challenge_id: string }>("start", { email, "cf-turnstile-response": turnstileToken }, fetchImpl);

export const verifyCode = (challengeId: string, email: string, code: string, fetchImpl?: typeof fetch) =>
  post<{ token: string; expires_in: number }>("verify", { challenge_id: challengeId, email, code }, fetchImpl);

export const loadResults = (token: string, fetchImpl?: typeof fetch) =>
  post<{ findings: DeepFinding[]; retention_days: number; min_confidence: number }>("results", { token }, fetchImpl);

export const deleteMyData = (token: string, fetchImpl?: typeof fetch) => post<{ deleted: number }>("delete", { token }, fetchImpl);
