// MPC-9799 (EXT-12): /business and /dpa say what the code does: the admin invites, each employee consents for themselves, the employer sees totals unless the employee shares.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderPage } from "@/test/render";
import Business from "./Business";
import DPA from "./DPA";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("/business: who authorises and what the employer sees", () => {
  it("step 01 is an invitation, not an uploaded list, and says a list is not consent", () => {
    renderPage(<Business />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("Invite your team");
    expect(text).toContain("A list of emails from you is not their consent.");
    expect(text).not.toContain("Submit your team list");
    expect(text).not.toContain("Provide a list of employee names and work emails");
  });

  it("step 03 says counts for the people who agreed, and detail only if the person shares it", () => {
    renderPage(<Business />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("You get a team summary");
    expect(text).toContain("You see one person's detail only if that person chooses to share it with you.");
    expect(text).not.toContain("who's exposed, what data is visible");
  });
});

describe("/dpa: employee privacy checks", () => {
  it("states authorisation, what the employer sees and what a match is", () => {
    renderPage(<DPA />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("A list of emails from you is not an employee’s consent.");
    expect(text).toContain("only if that employee chooses to share them with you");
    expect(text).toContain("a possible match is a guess");
  });
});

describe("the text matches the code", () => {
  const worker = readFileSync("workers/scan-report/lib/business.js", "utf8");
  const sql = readFileSync("supabase/migrations/20261108160000_mpc_9824_business_teams.sql", "utf8");
  it("an employee must consent before the check runs, and detail is shown to the admin only when shared", () => {
    expect(worker).toContain("if (b.consent !== true) return json({ error: 'Consent required' }, 400);");
    expect(sql).toContain("case when m.status = 'authorised' and m.share_detail then m.results else null end");
  });
});
