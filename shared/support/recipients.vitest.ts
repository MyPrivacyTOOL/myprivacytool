// @vitest-environment node
// MPC-9885: every outbound call of the support classes goes through the recipient wrapper and reaches a registered host.
import { describe, it, expect } from "vitest";
import { createFetchSpy } from "../recipients/fetch-spy";
import { RestCaseStore, RestAccountLookup, RestProofStore, ScansReportStatusReader, RestFollowupStore, ResendNotifier, ChatCompletionsModel, GithubIssueIntake, readFollowupMetrics } from "./index";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const BASE = "https://x.supabase.co";
const UID = "123e4567-e89b-12d3-a456-426614174000";

describe("support classes reach only registered recipients", () => {
  it("Supabase-backed classes, Resend, the model and GitHub", async () => {
    const spy = createFetchSpy({ respond: (url) => (url.includes("/users?") ? json([{ id: UID, email: "a@b.co" }]) : url.includes("support_followup_metrics") ? json([{ unresolved_cases: 0, overdue_actions: 0, retry_exhausted: 0, delivery_failing: 0, reopened_cases: 0, resolved_cases: 0, oldest_open_age_seconds: 0 }]) : url.includes("resend") ? json({ id: "m1" }) : url.includes("chat/completions") ? json({ choices: [{ message: { content: "hi" } }] }) : url.includes("api.github.com") ? json(url.includes("issues?") ? [] : { number: 7 }) : json([])) });
    const f = spy.fetch;
    expect(await new RestAccountLookup({ baseUrl: BASE, serviceKey: "k", fetchImpl: f }).findByEmail("a@b.co")).not.toBeNull();
    await new ScansReportStatusReader({ baseUrl: BASE, serviceKey: "k", fetchImpl: f }).statusFor(UID, "mpt");
    await readFollowupMetrics({ baseUrl: BASE, serviceKey: "k", fetchImpl: f });
    await new RestCaseStore({ baseUrl: BASE, serviceKey: "k", fetchImpl: f }).findCaseByThread("email", "t1");
    await expect(new RestFollowupStore({ baseUrl: BASE, serviceKey: "k", fetchImpl: f }).hasUnconfirmedAttempt("c1", "k", "2026-01-01T00:00:00Z")).resolves.toBe(false);
    await expect(new RestProofStore({ baseUrl: BASE, serviceKey: "k", fetchImpl: f }).redeem("short")).resolves.toBeNull(); // malformed: no call
    await new ResendNotifier({ apiKey: "k", from: "s@myprivacytool.io", fetchImpl: f }).send("C-1", "email", "hello", undefined, "a@b.co");
    await new ChatCompletionsModel({ baseUrl: "https://dashscope-intl.aliyuncs.com/v1", apiKey: "k", model: "m", fetchImpl: f }).complete({ system: "s", knowledge: [], caseText: "help", allowedTools: [] } as never);
    await new GithubIssueIntake({ repo: "o/r", token: "t", fetchImpl: f }).submit({ caseRef: "C-1", area: "a", occurrences: 1, title: "t", summary: "s", reproSteps: [], redactions: 0 } as never);
    spy.assertAllRegistered();
    expect(new Set(spy.calls.map((c) => c.host))).toEqual(new Set(["x.supabase.co", "api.resend.com", "dashscope-intl.aliyuncs.com", "api.github.com"]));
  });

  it("a host outside the registry is refused before any request is made", async () => {
    const spy = createFetchSpy();
    await expect(new RestAccountLookup({ baseUrl: "https://evil.example", serviceKey: "k", fetchImpl: spy.fetch }).findByEmail("a@b.co")).rejects.toMatchObject({ code: "HOST_MISMATCH" });
    expect(spy.calls).toHaveLength(0);
  });
});
