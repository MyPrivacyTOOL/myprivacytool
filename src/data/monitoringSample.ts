// Sample findings for the MPC-7649 dashboard preview. Not real people or real breach records.
import { fingerprintFor, type Finding, type Subscription } from "@/lib/monitoring";

export const SAMPLE_SUBSCRIPTION: Subscription = {
  tier: "pro",
  email: "sample@example.com",
  phoneE164: null,
  smsOptInAt: null,
  alertEmail: true,
  dailyBreach: true,
  weeklyDarkweb: true,
  monthlyReport: true,
};

export const SAMPLE_LAST_RUNS = {
  daily_breach: "2026-10-12T06:00:00Z",
  weekly_darkweb: "2026-10-06T06:00:00Z",
  monthly_report: "2026-09-13T06:00:00Z",
} as const;

export const SAMPLE_FINDINGS: Finding[] = [
  { id: "s1", foundAt: "2026-10-11T06:02:00Z", source: "breach_db", label: "ExampleShop (2026)", dataClasses: ["Email addresses", "Passwords"], severity: "high", status: "new", fingerprint: fingerprintFor("breach_db", "sample@example.com", "ExampleShop 2026") },
  { id: "s2", foundAt: "2026-10-06T06:10:00Z", source: "dark_web", label: "Paste site listing", dataClasses: ["Email addresses"], severity: "medium", status: "seen", fingerprint: fingerprintFor("dark_web", "sample@example.com", "Paste site listing") },
  { id: "s3", foundAt: "2026-09-20T06:01:00Z", source: "social", label: "Public profile scraped", dataClasses: ["Names", "Usernames"], severity: "low", status: "resolved", fingerprint: fingerprintFor("social", "sample@example.com", "Public profile scraped") },
];
