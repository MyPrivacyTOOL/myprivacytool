// MPC-9885 (Open Tracker design 1.3): the Worker / Pages Function side of the recipient wrapper. Builds the RecipientContext every converted call
// site uses, and the scan_recipient_log sink. Web-standard APIs only (the same file is bundled into every wrangler build).
//
//   const rctx = workerRecipientContext(env, { fetchImpl, scanId });          // scanId only inside a scan; everything else omits it
//   const res  = await recipientFetcher("resend", ["email"], rctx)(url, init);  // or callRecipient("resend", { url, init, sent: ["email"] }, rctx)
//   await rctx.flush?.();                                                      // once, at the end of the job: one INSERT for the whole scan
//
// What gets logged (scan_recipient_log): scan id, recipient key, data item NAMES, time, status, HTTP status, error code. Never a value, a URL or a
// header. A call made outside a scan (no scanId: cron collectors, ops notifications, the content pipeline) writes no row; there is no scan to hang it on.
import { callRecipient, type RecipientContext, type RecipientLogEntry } from "./outbound.ts";

/**
 * Check 4 (consent id for post_click recipients). The server-side consent store is MPC-9887. Until it exists a Worker has no consent id to present and
 * must not invent one, so check 4 is skipped for Workers and Functions only: every other check (key, enabled, flag, country, host, declared items,
 * user_supplied rules) runs on every call. MPC-9887 flips this constant to true and supplies `verifyConsent`; a test pins both that it is a constant
 * and that no other code path turns check 4 off.
 */
export const CONSENT_GATE_ACTIVE = false;

type Env = Record<string, unknown> | undefined | null;

export interface WorkerContextOptions {
  fetchImpl?: typeof fetch;
  /** Set only inside a scan. Rows are written for calls that carry it. */
  scanId?: string | null;
  /** Cloudflare cf.country of the visitor, if the call is on a visitor's behalf. */
  country?: string | null;
  /** Consent id from the gate (MPC-9887). Ignored until CONSENT_GATE_ACTIVE. */
  consentId?: string | null;
  verifyConsent?: RecipientContext["verifyConsent"];
  /** Overrides the sink (tests). Pass `null` to disable logging. */
  sink?: RecipientLogSink | null;
  /** Runs right before each network call (subrequest budget guards). See RecipientContext.beforeCall. */
  beforeCall?: RecipientContext["beforeCall"];
}

export interface RecipientLogSink {
  log: (entry: RecipientLogEntry) => void;
  /** Writes everything buffered in ONE request. Never throws; resolves to the number of rows written (0 on failure or nothing to write). */
  flush: () => Promise<number>;
  readonly pending: number;
}

export type WorkerRecipientContext = RecipientContext & { flush: () => Promise<number> };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The service-role key name differs between Workers; take whichever this Worker has. */
export function supabaseCredentials(env: Env): { url: string; key: string } | null {
  const e = (env ?? {}) as Record<string, unknown>;
  const url = str(e.SUPABASE_URL).replace(/\/+$/, "");
  const key = str(e.SUPABASE_SERVICE_ROLE_KEY) || str(e.SUPABASE_SERVICE_KEY) || str(e.SUPABASE_KEY);
  return url && key ? { url, key } : null;
}

const MAX_BUFFER = 200; // a scan makes a few dozen calls; this only bounds a runaway loop

/** Buffers log entries for one scan and writes them with a single INSERT. The write itself goes through the wrapper (key "supabase", no items, no log). */
export function createRecipientLogSink(env: Env, fetchImpl?: typeof fetch): RecipientLogSink {
  const buf: Record<string, unknown>[] = [];
  return {
    log(entry) {
      if (!entry.scan_id || buf.length >= MAX_BUFFER) return;
      buf.push({ scan_id: entry.scan_id, recipient_key: entry.key, items: entry.items, status: entry.status, http_status: entry.http_status ?? null, code: entry.code ?? null, at: entry.at });
    },
    async flush() {
      const creds = supabaseCredentials(env);
      if (!creds || buf.length === 0) return 0;
      const rows = buf.splice(0, buf.length);
      try {
        const res = await callRecipient("supabase", {
          url: `${creds.url}/rest/v1/scan_recipient_log`,
          init: { method: "POST", headers: { apikey: creds.key, authorization: `Bearer ${creds.key}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(rows) },
          sent: [],
        }, { fetchImpl, consentGate: "pending_mpc_9887" });
        return res.ok ? rows.length : 0;
      } catch {
        return 0; // the log never breaks or changes the call it describes
      }
    },
    get pending() { return buf.length; },
  };
}

/** The context for converted Worker and Function call sites. Flags are read from `env` by name. */
export function workerRecipientContext(env: Env, opts: WorkerContextOptions = {}): WorkerRecipientContext {
  const sink = opts.sink === undefined ? (opts.scanId ? createRecipientLogSink(env, opts.fetchImpl) : null) : opts.sink;
  const e = (env ?? {}) as Record<string, unknown>;
  const ctx: WorkerRecipientContext = {
    flags: (name: string) => e[name],
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.scanId ? { scanId: opts.scanId } : {}),
    ...(opts.country ? { country: opts.country } : {}),
    ...(CONSENT_GATE_ACTIVE ? { consentId: opts.consentId ?? null, verifyConsent: opts.verifyConsent, consentGate: "enforce" as const } : { consentGate: "pending_mpc_9887" as const }),
    ...(opts.beforeCall ? { beforeCall: opts.beforeCall } : {}),
    ...(sink ? { log: sink.log } : {}),
    flush: sink ? sink.flush : async () => 0,
  };
  return ctx;
}
