import { describe, expect, it } from "vitest";
import { buildDefectHandoff, redact } from "./supportDefectHandoff";
import { buildReceipt, isLiveVerified } from "./supportReceipts";

describe("defect handoff is sanitised (MPC-8529)", () => {
  const dirty = {
    caseRef: "C-1042",
    area: "report" as const,
    summary: "Report link fails for jane.doe@example.invalid, token=abcdef0123456789abcdef0123456789 see https://myprivacytool.io/report?t=SECRETVALUE&e=jane@example.invalid",
    reproSteps: ["Open https://myprivacytool.io/report?t=SECRETVALUE", "Call +852 9123 4567 from 203.0.113.9", "Cookie: sessionid=abc123"],
    observed: "404 for user jane.doe@example.invalid",
    expected: "report loads",
    occurrences: 3,
  };
  const out = buildDefectHandoff(dirty);
  const blob = JSON.stringify(out);

  it("removes emails, tokens, query strings, phone numbers, IPs and cookies", () => {
    expect(blob).not.toMatch(/jane|SECRETVALUE|abcdef0123456789|9123 4567|203\.0\.113\.9|sessionid|abc123/i);
    expect(out.redactions).toBeGreaterThanOrEqual(6);
  });
  it("keeps the technically useful parts", () => {
    expect(out.title).toMatch(/^\[support:report\] Report link fails/);
    expect(out.expected).toBe("report loads");
    expect(out.occurrences).toBe(3);
  });
  it("can only route to engineering review and never allows an automatic fix", () => {
    expect(out.routing).toBe("engineering_review");
    expect(out.autoFixAllowed).toBe(false);
    expect(Object.keys(out)).not.toEqual(expect.arrayContaining(["founder", "assignee", "recipient", "email"]));
  });
  it("bounds field and step sizes", () => {
    const big = buildDefectHandoff({ caseRef: "C-1", area: "other", summary: "x".repeat(5000), reproSteps: Array.from({ length: 50 }, (_, i) => `step ${i}`) });
    expect(big.summary.length).toBeLessThanOrEqual(603);
    expect(big.reproSteps).toHaveLength(12);
  });
  it("does not trust a case reference that is really an email", () => {
    expect(buildDefectHandoff({ caseRef: "jane@example.invalid", area: "other", summary: "s" }).caseRef).toBe("[redacted-ref]");
  });
  it("redact() reports a count and is stable on clean text", () => {
    expect(redact("plain text")).toEqual({ text: "plain text", count: 0 });
  });
});

describe("receipts never overstate their evidence (MPC-8529)", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const base = { task: "MPC-8529", runId: "run-1", now, contractsProvisional: true };
  it("records expected vs actual and marks pass/fail", () => {
    const r = buildReceipt({ ...base, checks: [
      { name: "retry bound", expected: "exhausted after 3", actual: "exhausted after 3", evidence: "isolated_integration" },
      { name: "silence", expected: "waiting_customer", actual: "resolved", evidence: "isolated_integration" },
    ] });
    expect(r.schema).toBe("mpt.support.receipt/1");
    expect(r.generatedAt).toBe("2026-10-26T10:00:00.000Z");
    expect(r.summary).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(r.checks[1].pass).toBe(false);
  });
  it("mocked and isolated results can never be called live-verified", () => {
    const r = buildReceipt({ ...base, checks: [{ name: "a", expected: "x", actual: "x", evidence: "mocked" }, { name: "b", expected: "y", actual: "y", evidence: "isolated_integration" }] });
    expect(r.strongestEvidence).toBe("isolated_integration");
    expect(isLiveVerified(r)).toBe(false);
  });
  it("only a passing real-channel check with no failures counts as live", () => {
    const ok = buildReceipt({ ...base, checks: [{ name: "real", expected: "delivered", actual: "delivered", evidence: "real_channel" }] });
    const failed = buildReceipt({ ...base, checks: [{ name: "real", expected: "delivered", actual: "bounced", evidence: "real_channel" }] });
    expect(isLiveVerified(ok)).toBe(true);
    expect(isLiveVerified(failed)).toBe(false);
  });
  it("refuses to record personal data or tokens", () => {
    expect(() => buildReceipt({ ...base, checks: [{ name: "x", expected: "a", actual: "sent to jane@example.invalid", evidence: "mocked" }] })).toThrow(/personal data/);
    expect(() => buildReceipt({ ...base, checks: [{ name: "x", expected: "a", actual: "abcdefghijklmnopqrstuvwxyz0123456789", evidence: "mocked" }] })).toThrow(/token/);
  });
  it("an empty run has no evidence", () => {
    expect(buildReceipt({ ...base, checks: [] }).strongestEvidence).toBe("none");
  });
});
