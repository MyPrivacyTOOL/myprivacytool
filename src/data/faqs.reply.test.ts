// MPC-9826 (F7a): the FAQ and both Alice emails say the same thing about replying (one source: shared/reply-wording.js).
import { describe, it, expect } from "vitest";
import { FAQS } from "./faqs";
import { REPLY_PROMISE, REPLY_SENTENCE } from "../../shared/reply-wording.js";
import { buildConfirmationEmail, buildReportEmail } from "../../workers/scan-report/lib/email.js";
import { computeScore } from "../../workers/scan-report/lib/score.js";

describe("reply wording is the same in the FAQ and in both emails", () => {
  const faq = FAQS.find((f) => f.q === "Can I reply to my report email?");
  it("has the FAQ answer built from the shared sentences", () => {
    expect(faq?.a).toContain(REPLY_PROMISE);
  });
  it("is in the confirmation email (text and html)", () => {
    const m = buildConfirmationEmail({});
    expect(m.text).toContain(REPLY_SENTENCE);
    expect(m.html).toContain(REPLY_SENTENCE.replace(/’/g, "&#39;").replace("Alice&#39;s", "Alice’s"));
  });
  it("is in the report email", () => {
    const m = buildReportEmail({ scan: computeScore([], new Set()), breaches: [], breachStatus: "not_checked", brokers: [] });
    expect(m.text).toContain(REPLY_PROMISE);
  });
  it("no longer says there is no chat without saying where chat does exist, and never promises a reply time", () => {
    const alice = FAQS.find((f) => f.q === "Who or what is Alice?")!.a;
    expect(alice).toMatch(/no live chat with her on the site today/);
    expect(alice).toMatch(/coming/);
    expect(alice).not.toMatch(/There is no chat\./);
    expect(REPLY_PROMISE + faq?.a).not.toMatch(/within (one|a|\d)|instantly|right away/i);
  });
});
