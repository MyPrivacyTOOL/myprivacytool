import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BACKOFF_MINUTES, MAX_ATTEMPTS, SHARED_WITH_HELP, SHARED_WITH_INTAKE, backoffMinutes, canResolve, describeAvailability,
  isIndependentFallback, nextAfterAttempt, type Dependency,
} from "./supportFollowup";

const sql = readFileSync("supabase/sql/mpc-8529-support-followup.sql", "utf8");

describe("backoff and bound (MPC-8529, provisional until MPC-8530 approves numbers)", () => {
  it("stays in step with the SQL engine", () => {
    expect(BACKOFF_MINUTES).toEqual([15, 60, 360]);
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain("interval '6 hours'");
    expect(sql).toContain("max_attempts integer not null default " + MAX_ATTEMPTS);
  });
  it("is bounded and never goes below the first step", () => {
    expect(backoffMinutes(0)).toBe(15);
    expect(backoffMinutes(2)).toBe(60);
    expect(backoffMinutes(99)).toBe(360);
  });
  it("retries with backoff, then stops in unresolved_exhausted (no endless loop)", () => {
    let failures = 0;
    const seen: (number | null)[] = [];
    for (let i = 0; i < 10; i++) {
      const r = nextAfterAttempt(failures, "failed");
      seen.push(r.retryInMinutes);
      failures = r.failures;
      if (r.state === "unresolved_exhausted") break;
    }
    expect(seen).toEqual([15, 60, null]);
    expect(failures).toBe(MAX_ATTEMPTS);
  });
  it("does not count an attempt without a receipt as delivered", () => {
    expect(nextAfterAttempt(0, "attempted").delivered).toBe(false);
    expect(nextAfterAttempt(0, "attempted").state).toBe("delivery_failed");
    expect(nextAfterAttempt(2, "delivered")).toMatchObject({ delivered: true, failures: 0, state: "waiting_customer" });
  });
  it("silence never resolves; only a verified outcome does", () => {
    expect(canResolve("waiting_customer", true)).toBe(false);
    expect(canResolve("resolution_proposed", false)).toBe(false);
    expect(canResolve("resolution_proposed", true)).toBe(true);
  });
});

describe("outage wording is honest", () => {
  const FAILS: Dependency[][] = [["website"], ["ai"], ["backend"], ["transport"], ["scheduler"]];
  it.each(FAILS)("%s: never claims a case was saved when it was not, never promises a human", (...failed) => {
    const a = describeAvailability(failed as Dependency[]);
    expect(a.message).not.toMatch(/\b(human|agent|team will|within \d+ ?(hours|minutes)|call you)\b/i);
    expect(a.independent).toBe(false);
    if (failed[0] === "backend" || failed[0] === "website") expect(a.message).toMatch(/not (been )?saved|could not save|no case reference|Nothing/i);
  });
  it("only reports a saved case when intake was actually confirmed", () => {
    expect(describeAvailability(["ai"], false).message).toMatch(/has not been saved/);
    expect(describeAvailability(["ai"], true).message).toMatch(/is saved/);
  });
  it("a fallback on the failed dependency is not independent", () => {
    expect(isIndependentFallback(["website"], SHARED_WITH_HELP)).toBe(false);
    expect(isIndependentFallback(["backend"], SHARED_WITH_INTAKE)).toBe(false);
    expect(isIndependentFallback(["ai"], SHARED_WITH_HELP)).toBe(true);
    expect(isIndependentFallback([], SHARED_WITH_HELP)).toBe(false);
  });
});
