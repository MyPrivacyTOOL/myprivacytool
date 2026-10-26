import type { ReportStatusReader } from "./tools";

export interface ScansReaderConfig { baseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; restPrefix?: string; timeoutMs?: number }

const PHRASES: Record<string, string> = {
  pending: "your report is queued and has not been produced yet",
  processing: "your report is being produced now",
  sent: "your report was handed to our email provider; this record does not confirm it reached your inbox",
  failed: "producing your report failed; this record does not show whether a retry is scheduled",
};

/**
 * Read-only status of the most recent scan report for ONE account. The account id is injected by the tool gateway from the
 * verified identity; it is never taken from a request. It reads four columns of `scans` and returns coarse, honest wording:
 * it never claims delivery, a retry, or a time it cannot see. Assumes the verified subject id equals `public.users.id`
 * (to be confirmed by the identity-flow decision in MPC-8530).
 */
export class ScansReportStatusReader implements ReportStatusReader {
  constructor(private c: ScansReaderConfig) {
    if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) throw new Error("baseUrl must be https (or localhost for tests)");
    if (!c.serviceKey) throw new Error("serviceKey required");
  }
  async statusFor(subjectId: string, _tenantId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(subjectId)) return { found: false };
    const url = `${this.c.baseUrl.replace(/\/$/, "")}${this.c.restPrefix ?? "/rest/v1"}/scans?user_id=eq.${encodeURIComponent(subjectId)}&select=report_status,report_sent_at,scan_date&order=scan_date.desc&limit=1`;
    const res = await (this.c.fetchImpl ?? fetch)(url, { headers: { apikey: this.c.serviceKey, Authorization: `Bearer ${this.c.serviceKey}` }, signal: AbortSignal.timeout(this.c.timeoutMs ?? 5000) });
    if (!res.ok) throw new Error(`scan status read failed: ${res.status}`);
    const rows = (await res.json()) as { report_status?: string; report_sent_at?: string | null }[];
    if (!Array.isArray(rows)) throw new Error("unexpected response");
    const r = rows[0];
    if (!r) return { found: false };
    const phrase = PHRASES[r.report_status ?? ""];
    if (!phrase) return { found: true, status: "the record shows a status I do not recognise, so I can't describe it" };
    return { found: true, status: r.report_status === "sent" && r.report_sent_at ? `${phrase} (handed over ${r.report_sent_at.slice(0, 10)})` : phrase };
  }
}
