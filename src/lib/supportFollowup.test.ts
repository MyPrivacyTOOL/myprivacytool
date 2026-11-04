import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canTransition } from "../../shared/support/states";
import type { CaseState } from "../../shared/support/types";
import {
  BACKOFF_MINUTES, MAX_ATTEMPTS, SHARED_WITH_HELP, SHARED_WITH_INTAKE, TERMINAL_STATES, backoffMinutes, canResolve, describeAvailability,
  isIndependentFallback, nextAfterAttempt, type CaseState as FollowupCaseState, type Dependency,
} from "./supportFollowup";

const sql = readFileSync("supabase/proposed/mpc_8529_support_followup.sql", "utf8");

describe("backoff and bound (MPC-8529, provisional until MPC-8530 approves numbers)", () => {
  it("stays in step with the SQL engine", () => {
    expect(BACKOFF_MINUTES).toEqual([15, 60, 360]);
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain("interval '6 hours'");
    expect(sql).toContain("max_attempts integer not null default " + MAX_ATTEMPTS);
    expect(sql).toContain("'followup_exhausted'");
    expect(sql).toContain("'reply_delivery_failed'");
  });
  it("is bounded and never goes below the first step", () => {
    expect(backoffMinutes(0)).toBe(15);
    expect(backoffMinutes(2)).toBe(60);
    expect(backoffMinutes(99)).toBe(360);
  });
  it("retries with backoff, then stops in blocked / followup_exhausted (no endless loop)", () => {
    let failures = 0;
    const seen: (number | null)[] = [];
    let last = nextAfterAttempt(0, "failed");
    for (let i = 0; i < 10; i++) {
      last = nextAfterAttempt(failures, "failed");
      seen.push(last.retryInMinutes);
      failures = last.failures;
      if (last.state === "blocked") break;
    }
    expect(seen).toEqual([15, 60, null]);
    expect(failures).toBe(MAX_ATTEMPTS);
    expect(last).toMatchObject({ state: "blocked", reason: "followup_exhausted" });
  });
  it("does not count an attempt without a receipt as delivered", () => {
    expect(nextAfterAttempt(0, "attempted").delivered).toBe(false);
    expect(nextAfterAttempt(0, "attempted")).toMatchObject({ state: "waiting_system", reason: "reply_delivery_failed" });
    expect(nextAfterAttempt(2, "delivered")).toMatchObject({ delivered: true, failures: 0, state: "waiting_customer" });
  });
  it("silence never resolves; only a verified outcome does", () => {
    expect(canResolve("waiting_customer", false, true)).toBe(false); // nothing proposed: silence or a bare "ok" is not a resolution
    expect(canResolve("diagnosing", true, false)).toBe(false);       // proposed but the outcome check failed
    expect(canResolve("diagnosing", true, true)).toBe(true);
    expect(canResolve("blocked", true, true)).toBe(false);           // finished/exhausted cases are not re-resolved here
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

describe("follow-up moves cases only along MPC-8528's own transitions", () => {
  const STATES: CaseState[] = ["new", "triage", "diagnosing", "action_running", "waiting_customer", "waiting_system", "resolved", "closed", "reopened", "blocked"];
  // Pull the (from,to) pairs out of support_followup_can_move in the SQL file.
  const body = sql.slice(sql.indexOf("support_followup_can_move"), sql.indexOf("-- Proposed backoff"));
  const pairs = new Set([...body.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`));
  it("the SQL transition table equals shared/support/states.ts", () => {
    for (const a of STATES) for (const b of STATES) {
      if (a === b) continue;
      expect(pairs.has(`${a}>${b}`), `${a} -> ${b}`).toBe(canTransition(a, b));
    }
  });
  it("every state this module returns is reachable from an active state under MPC-8528 rules", () => {
    for (const from of STATES.filter((s) => !TERMINAL_STATES.includes(s as FollowupCaseState) && s !== "new")) {
      const failed = nextAfterAttempt(0, "failed").state as CaseState;
      const delivered = nextAfterAttempt(0, "delivered").state as CaseState;
      expect(from === failed || canTransition(from, failed), `${from} -> ${failed}`).toBe(true);
      expect(from === delivered || canTransition(from, delivered) || from === "waiting_customer", `${from} -> ${delivered}`).toBe(true);
    }
  });
});
