// Continuous monitoring logic for Pro and Executive plans (MPC-7649). Pure functions only: the schedule, the
// "is this exposure new" test, who gets alerted and how, and the dashboard numbers. The Worker that calls the
// breach / dark web providers and sends the messages is not built yet; it will use these same functions so the
// dashboard and the alerts cannot disagree.

export type MonitorKind = "daily_breach" | "weekly_darkweb" | "monthly_report";
export type FindingSource = "breach_db" | "dark_web" | "social";
export type Severity = "low" | "medium" | "high";
export type FindingStatus = "new" | "seen" | "resolved" | "not_mine";

export interface Finding {
  id: string;
  foundAt: string;
  source: FindingSource;
  label: string;
  dataClasses: string[];
  fingerprint: string;
  severity: Severity;
  status: FindingStatus;
}

export interface Subscription {
  tier: "pro" | "executive";
  email: string;
  phoneE164?: string | null;
  smsOptInAt?: string | null;
  alertEmail: boolean;
  dailyBreach: boolean;
  weeklyDarkweb: boolean;
  monthlyReport: boolean;
}

export const FALSE_POSITIVE_TARGET_PCT = 1;
const DAY_MS = 86_400_000;

export const KIND_INTERVAL_DAYS: Record<MonitorKind, number> = {
  daily_breach: 1,
  weekly_darkweb: 7,
  monthly_report: 30,
};

export const KIND_LABEL: Record<MonitorKind, string> = {
  daily_breach: "Daily breach check",
  weekly_darkweb: "Weekly dark web scan",
  monthly_report: "Monthly report",
};

/** The checks a subscription has switched on. */
export function enabledKinds(s: Pick<Subscription, "dailyBreach" | "weeklyDarkweb" | "monthlyReport">): MonitorKind[] {
  const kinds: MonitorKind[] = [];
  if (s.dailyBreach) kinds.push("daily_breach");
  if (s.weeklyDarkweb) kinds.push("weekly_darkweb");
  if (s.monthlyReport) kinds.push("monthly_report");
  return kinds;
}

/** When a check is next due: one interval after the last run, or now when it has never run. */
export function nextDue(kind: MonitorKind, lastRunAt: string | null, now: Date = new Date()): Date {
  if (!lastRunAt) return now;
  const last = new Date(lastRunAt).getTime();
  if (Number.isNaN(last)) return now;
  return new Date(last + KIND_INTERVAL_DAYS[kind] * DAY_MS);
}

export function isDue(kind: MonitorKind, lastRunAt: string | null, now: Date = new Date()): boolean {
  return nextDue(kind, lastRunAt, now).getTime() <= now.getTime();
}

/** Stable key for one exposure: the same source + identifier + breach always gives the same value. */
export function fingerprintFor(source: FindingSource, identifier: string, breach: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const text = `${source}|${norm(identifier)}|${norm(breach)}`;
  // FNV-1a, twice with different seeds -> 16 hex chars. Not a security hash; only a dedupe key.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Of the candidates a check returned, keep the ones not already recorded (and drop repeats within the batch). */
export function newFindings<T extends { fingerprint: string }>(known: ReadonlySet<string>, candidates: T[]): T[] {
  const seen = new Set(known);
  const out: T[] = [];
  for (const c of candidates) {
    if (seen.has(c.fingerprint)) continue;
    seen.add(c.fingerprint);
    out.push(c);
  }
  return out;
}

export interface AlertPlan {
  email: boolean;
  sms: boolean;
}

/** Email goes out when switched on. SMS needs a number AND a recorded opt-in, and is kept for high severity. */
export function alertChannels(s: Subscription, severity: Severity): AlertPlan {
  const smsAllowed = !!s.phoneE164 && !!s.smsOptInAt;
  return { email: s.alertEmail, sms: smsAllowed && severity === "high" };
}

export interface MonitoringStats {
  total: number;
  open: number;
  highOpen: number;
  falsePositives: number;
  falsePositivePct: number;
  meetsFalsePositiveTarget: boolean;
}

export function summarise(findings: Finding[]): MonitoringStats {
  const total = findings.length;
  const open = findings.filter((f) => f.status === "new" || f.status === "seen").length;
  const highOpen = findings.filter((f) => f.severity === "high" && (f.status === "new" || f.status === "seen")).length;
  const falsePositives = findings.filter((f) => f.status === "not_mine").length;
  const falsePositivePct = total === 0 ? 0 : Math.round((falsePositives / total) * 10_000) / 100;
  return { total, open, highOpen, falsePositives, falsePositivePct, meetsFalsePositiveTarget: falsePositivePct < FALSE_POSITIVE_TARGET_PCT };
}

/** Newest first, then high severity first within the same moment. */
export function sortFindings(findings: Finding[]): Finding[] {
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return [...findings].sort((a, b) => b.foundAt.localeCompare(a.foundAt) || rank[a.severity] - rank[b.severity]);
}

export function markFinding(findings: Finding[], id: string, status: FindingStatus): Finding[] {
  return findings.map((f) => (f.id === id ? { ...f, status } : f));
}
