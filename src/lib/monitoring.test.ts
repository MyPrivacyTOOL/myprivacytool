// MPC-7649: continuous monitoring logic.
import { describe, expect, it } from "vitest";
import {
  alertChannels,
  enabledKinds,
  fingerprintFor,
  isDue,
  markFinding,
  newFindings,
  nextDue,
  sortFindings,
  summarise,
  type Finding,
  type Subscription,
} from "./monitoring";

const sub: Subscription = { tier: "pro", email: "a@b.co", alertEmail: true, dailyBreach: true, weeklyDarkweb: true, monthlyReport: false };
const f = (id: string, over: Partial<Finding> = {}): Finding => ({
  id, foundAt: "2026-10-01T00:00:00Z", source: "breach_db", label: id, dataClasses: [], fingerprint: id.padEnd(8, "x"), severity: "medium", status: "new", ...over,
});

describe("schedule", () => {
  it("lists only the switched-on checks", () => {
    expect(enabledKinds(sub)).toEqual(["daily_breach", "weekly_darkweb"]);
  });
  it("is due immediately when never run, and one interval after the last run", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(isDue("daily_breach", null, now)).toBe(true);
    expect(isDue("daily_breach", "2026-10-11T12:00:00Z", now)).toBe(true);
    expect(isDue("daily_breach", "2026-10-11T12:00:01Z", now)).toBe(false);
    expect(nextDue("weekly_darkweb", "2026-10-05T12:00:00Z", now).toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(isDue("monthly_report", "garbage", now)).toBe(true);
  });
});

describe("dedupe", () => {
  it("fingerprint ignores case and spacing but not source or breach", () => {
    const a = fingerprintFor("breach_db", " A@B.co ", "Example  Shop");
    expect(fingerprintFor("breach_db", "a@b.co", "example shop")).toBe(a);
    expect(fingerprintFor("dark_web", "a@b.co", "example shop")).not.toBe(a);
    expect(fingerprintFor("breach_db", "a@b.co", "other")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("keeps only unseen findings and drops repeats inside one batch", () => {
    const out = newFindings(new Set(["oldxxxxx"]), [f("old"), f("new1"), f("new1"), f("new2")]);
    expect(out.map((x) => x.id)).toEqual(["new1", "new2"]);
  });
});

describe("alerts", () => {
  it("sends email only, unless there is a number and an opt-in and the finding is high", () => {
    expect(alertChannels(sub, "high")).toEqual({ email: true, sms: false });
    const withPhone = { ...sub, phoneE164: "+85255550000" };
    expect(alertChannels(withPhone, "high").sms).toBe(false);
    const opted = { ...withPhone, smsOptInAt: "2026-10-01T00:00:00Z" };
    expect(alertChannels(opted, "high").sms).toBe(true);
    expect(alertChannels(opted, "medium").sms).toBe(false);
    expect(alertChannels({ ...opted, alertEmail: false }, "low").email).toBe(false);
  });
});

describe("dashboard numbers", () => {
  it("counts open, high and false positives against the 1% target", () => {
    const list = [f("a", { severity: "high" }), f("b", { status: "seen" }), f("c", { status: "resolved" }), f("d", { status: "not_mine" })];
    expect(summarise(list)).toMatchObject({ total: 4, open: 2, highOpen: 1, falsePositives: 1, falsePositivePct: 25, meetsFalsePositiveTarget: false });
    const many = Array.from({ length: 200 }, (_, i) => f(`x${i}`, i === 0 ? { status: "not_mine" } : {}));
    expect(summarise(many)).toMatchObject({ falsePositivePct: 0.5, meetsFalsePositiveTarget: true });
    expect(summarise([])).toMatchObject({ total: 0, falsePositivePct: 0, meetsFalsePositiveTarget: true });
  });
  it("sorts newest first and updates one finding without mutating", () => {
    const list = [f("old", { foundAt: "2026-09-01T00:00:00Z" }), f("new", { foundAt: "2026-10-01T00:00:00Z" })];
    expect(sortFindings(list).map((x) => x.id)).toEqual(["new", "old"]);
    const next = markFinding(list, "old", "resolved");
    expect(next[0].status).toBe("resolved");
    expect(list[0].status).toBe("new");
  });
});
