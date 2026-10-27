import { describe, expect, it } from "vitest";
import { GithubIssueIntake } from "./github-issue-intake";
import { evaluateMetrics, PROPOSED_THRESHOLDS, readFollowupMetrics } from "./followup-metrics";
import { reportDefect } from "./engineering-intake";

type Call = { method: string; url: string; body?: string; auth?: string };
function gh(handler: (c: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c: Call = { method: init.method ?? "GET", url, body: init.body as string | undefined, auth: (init.headers as Record<string, string>).Authorization };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const dirty = { caseRef: "SUP-AAAAAAA2", area: "report" as const, summary: "Report 404 for jane@example.invalid token=abcdef0123456789abcdef0123456789", reproSteps: ["open link", "see 404"], observed: "404", expected: "loads", occurrences: 2 };

describe("GithubIssueIntake (MPC-8529, not activated)", () => {
  it("creates one labelled issue with the sanitised payload and nothing else", async () => {
    const t = gh((c) => (c.method === "GET" ? { status: 200, body: [] } : { status: 201, body: { number: 42 } }));
    const r = await reportDefect(new GithubIssueIntake({ repo: "MyPrivacyTOOL/myprivacytool", token: "tok", fetchImpl: t.fetchImpl }), dirty);
    expect(r).toMatchObject({ sent: true, reference: "#42" });
    const post = t.calls.find((c) => c.method === "POST")!;
    const sent = JSON.parse(post.body!);
    expect(post.url).toBe("https://api.github.com/repos/MyPrivacyTOOL/myprivacytool/issues");
    expect(Object.keys(sent).sort()).toEqual(["body", "labels", "title"]);            // no assignees, milestone, mentions
    expect(sent.labels).toEqual(["support-defect"]);
    expect(post.body).not.toMatch(/jane|abcdef0123456789|"tok"/);
    expect(sent.body).toMatch(/no automatic fix, no production change and no customer contact/);
    expect(sent.body).not.toMatch(/@[A-Za-z]/);                                         // never pings a person
  });
  it("a repeat for the same case and area returns the existing issue and creates nothing", async () => {
    const t = gh((c) => (c.method === "GET" ? { status: 200, body: [{ number: 7, body: "x <!-- mpt-support-defect:SUP-AAAAAAA2:report --> y" }] } : { status: 201, body: { number: 8 } }));
    const r = await reportDefect(new GithubIssueIntake({ repo: "MyPrivacyTOOL/myprivacytool", token: "tok", fetchImpl: t.fetchImpl }), dirty);
    expect(r).toMatchObject({ sent: true, reference: "#7" });
    expect(t.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("pull requests are never treated as the existing issue", async () => {
    const t = gh((c) => (c.method === "GET" ? { status: 200, body: [{ number: 9, pull_request: {}, body: "<!-- mpt-support-defect:SUP-AAAAAAA2:report -->" }] } : { status: 201, body: { number: 10 } }));
    expect(await reportDefect(new GithubIssueIntake({ repo: "a/b", token: "t", fetchImpl: t.fetchImpl }), dirty)).toMatchObject({ reference: "#10" });
  });
  it("any GitHub failure is reported as not sent, never as sent", async () => {
    for (const status of [401, 403, 404, 422, 500]) {
      const t = gh(() => ({ status }));
      expect(await reportDefect(new GithubIssueIntake({ repo: "a/b", token: "t", fetchImpl: t.fetchImpl }), dirty)).toMatchObject({ sent: false, reason: "intake_unavailable" });
    }
    const noNumber = gh((c) => (c.method === "GET" ? { status: 200, body: [] } : { status: 201, body: {} }));
    expect(await reportDefect(new GithubIssueIntake({ repo: "a/b", token: "t", fetchImpl: noNumber.fetchImpl }), dirty)).toMatchObject({ sent: false });
  });
  it("rejects a malformed repo or a missing token at construction", () => {
    expect(() => new GithubIssueIntake({ repo: "not a repo", token: "t" })).toThrow("owner/repo");
    expect(() => new GithubIssueIntake({ repo: "../x/y?z", token: "t" })).toThrow("owner/repo");
    expect(() => new GithubIssueIntake({ repo: "a/b", token: "" })).toThrow("token");
  });
});

describe("follow-up metrics (MPC-8529)", () => {
  const row = { unresolved_cases: "3", overdue_actions: "0", retry_exhausted: "0", delivery_failing: "1", reopened_cases: "2", resolved_cases: "9", oldest_open_age_seconds: "3600" };
  const mk = (status: number, body: unknown) => ({ baseUrl: "http://127.0.0.1:3000", serviceKey: "k", restPrefix: "", fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch });
  it("reads counts (bigint strings included) from the view", async () => {
    expect(await readFollowupMetrics(mk(200, [row]))).toEqual({ unresolvedCases: 3, overdueActions: 0, retryExhausted: 0, deliveryFailing: 1, reopenedCases: 2, resolvedCases: 9, oldestOpenAgeSeconds: 3600 });
  });
  it("fails closed: an outage or a malformed row is an error, not an all-clear", async () => {
    await expect(readFollowupMetrics(mk(503, []))).rejects.toThrow("503");
    await expect(readFollowupMetrics(mk(200, []))).rejects.toThrow("unexpected");
    await expect(readFollowupMetrics(mk(200, [{ ...row, overdue_actions: "x" }]))).rejects.toThrow("bad metric");
    await expect(readFollowupMetrics(mk(200, [{ ...row, overdue_actions: -1 }]))).rejects.toThrow("bad metric");
  });
  it("raises an alert for overdue actions, exhausted retries, failing delivery and old cases", () => {
    const base = { unresolvedCases: 1, overdueActions: 0, retryExhausted: 0, deliveryFailing: 0, reopenedCases: 0, resolvedCases: 0, oldestOpenAgeSeconds: 0 };
    expect(evaluateMetrics(base)).toEqual({ ok: true, alerts: [] });
    expect(evaluateMetrics({ ...base, overdueActions: 1 }).alerts[0]).toMatch(/overdue_actions=1/);
    expect(evaluateMetrics({ ...base, retryExhausted: 2 }).alerts[0]).toMatch(/retry_exhausted=2/);
    expect(evaluateMetrics({ ...base, deliveryFailing: 4 }).alerts[0]).toMatch(/delivery_failing=4/);
    expect(evaluateMetrics({ ...base, oldestOpenAgeSeconds: 73 * 3600 }).alerts[0]).toMatch(/oldest_open_age_hours=73/);
    expect(evaluateMetrics({ ...base, deliveryFailing: 3, oldestOpenAgeSeconds: 72 * 3600 }).ok).toBe(true);   // at the threshold is fine
    expect(PROPOSED_THRESHOLDS.maxOverdue).toBe(0);
  });
  it("alerts contain counts only", () => {
    const a = evaluateMetrics({ unresolvedCases: 9, overdueActions: 5, retryExhausted: 5, deliveryFailing: 9, reopenedCases: 0, resolvedCases: 0, oldestOpenAgeSeconds: 999999 }).alerts.join(" ");
    expect(a).not.toMatch(/SUP-|@|http/);
  });
});
