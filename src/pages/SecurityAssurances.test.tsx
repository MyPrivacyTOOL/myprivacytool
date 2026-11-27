// MPC-9808 (TRUST-020, PRIVACY-009): the Privacy security section only claims what has dated evidence (docs/security-assurances-mpc-9808.md),
// and /data-deletion describes the account-deletion path that exists in code.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderPage } from "@/test/render";
import Privacy from "./Privacy";
import DataDeletion from "./DataDeletion";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Privacy section 8: security claims", () => {
  it("does not claim regular audits and says what was actually done, with a date", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).not.toMatch(/Regular Audits/i);
    expect(text).toContain("We reviewed our servers and database settings in October 2026 and fixed what we found. We have no fixed audit schedule");
  });

  it("keeps TLS 1.3 and says at-rest encryption is the database provider's platform-level encryption", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("All data transmitted over HTTPS (TLS 1.3)");
    expect(text).toContain("the database provider encrypts stored data at platform level");
  });

  it("every claim kept in section 8 appears in the evidence document", () => {
    const doc = readFileSync("docs/security-assurances-mpc-9808.md", "utf8");
    for (const claim of ["TLS 1.3", "encrypted in our databases", "Role-based access", "Regular Audits"]) expect(doc).toContain(claim);
  });
});

describe("/data-deletion", () => {
  it("describes the account-deletion path using the button text the account page really has", () => {
    const button = /Delete my account and all scans/.exec(readFileSync("src/pages/Account.tsx", "utf8"))?.[0];
    expect(button).toBeDefined();
    renderPage(<DataDeletion />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("Delete your free account yourself");
    expect(text).toContain(`\u201c${button}\u201d`);
    expect(document.querySelector('a[href="/account"]')).not.toBeNull();
  });

  it("keeps the 30-day promise for emailed requests", () => {
    renderPage(<DataDeletion />);
    expect(flat(document.body.textContent ?? "")).toContain("We will respond within 30 days.");
  });
});
