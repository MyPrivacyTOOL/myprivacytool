// MPC-8529: read the personal-data-free follow-up metrics (view support_followup_metrics) and turn them into plain alerts.
// Definitions: docs/support-followup-watchdog-mpc-8529-prep.md section 7. Counts only; no case reference, address or text.

export interface FollowupMetrics {
  unresolvedCases: number;
  overdueActions: number;
  retryExhausted: number;
  deliveryFailing: number;
  reopenedCases: number;
  resolvedCases: number;
  oldestOpenAgeSeconds: number;
}

export interface FollowupMetricsConfig { baseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; timeoutMs?: number; restPrefix?: string }

const num = (v: unknown, name: string): number => {
  const n = typeof v === "string" ? Number(v) : v;                        // bigint columns arrive as strings
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error(`bad metric ${name}`);
  return n;
};

/** Fail-closed: any non-2xx, timeout or malformed row throws, so a monitor reports "unknown", never "all clear". */
export async function readFollowupMetrics(c: FollowupMetricsConfig): Promise<FollowupMetrics> {
  if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) throw new Error("baseUrl must be https (or localhost for tests)");
  if (!c.serviceKey) throw new Error("serviceKey required");
  const res = await (c.fetchImpl ?? fetch)(`${c.baseUrl.replace(/\/$/, "")}${c.restPrefix ?? "/rest/v1"}/support_followup_metrics?select=*`, {
    headers: { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}` },
    signal: AbortSignal.timeout(c.timeoutMs ?? 5000),
  });
  if (!res.ok) throw new Error(`metrics read failed: ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("unexpected metrics response");
  const r = rows[0];
  return {
    unresolvedCases: num(r.unresolved_cases, "unresolved_cases"), overdueActions: num(r.overdue_actions, "overdue_actions"),
    retryExhausted: num(r.retry_exhausted, "retry_exhausted"), deliveryFailing: num(r.delivery_failing, "delivery_failing"),
    reopenedCases: num(r.reopened_cases, "reopened_cases"), resolvedCases: num(r.resolved_cases, "resolved_cases"),
    oldestOpenAgeSeconds: num(r.oldest_open_age_seconds, "oldest_open_age_seconds"),
  };
}

export interface MetricThresholds { maxOverdue: number; maxOldestOpenHours: number; maxExhausted: number; maxDeliveryFailing: number }
/** Proposed defaults, NOT approved numbers (MPC-8530 decides). A non-zero overdue count means the watchdog or worker is not keeping up. */
export const PROPOSED_THRESHOLDS: MetricThresholds = { maxOverdue: 0, maxOldestOpenHours: 72, maxExhausted: 0, maxDeliveryFailing: 3 };

export function evaluateMetrics(m: FollowupMetrics, t: MetricThresholds = PROPOSED_THRESHOLDS): { ok: boolean; alerts: string[] } {
  const alerts: string[] = [];
  if (m.overdueActions > t.maxOverdue) alerts.push(`overdue_actions=${m.overdueActions}: the sweep or worker is not keeping up`);
  if (m.retryExhausted > t.maxExhausted) alerts.push(`retry_exhausted=${m.retryExhausted}: cases ended unresolved after the retry bound`);
  if (m.deliveryFailing > t.maxDeliveryFailing) alerts.push(`delivery_failing=${m.deliveryFailing}: a channel is failing to deliver`);
  if (m.oldestOpenAgeSeconds > t.maxOldestOpenHours * 3600) alerts.push(`oldest_open_age_hours=${Math.floor(m.oldestOpenAgeSeconds / 3600)}: a case has been open longer than ${t.maxOldestOpenHours} h`);
  return { ok: alerts.length === 0, alerts };
}
