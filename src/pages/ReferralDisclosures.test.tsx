// MPC-9807 (EXT-20): the referral and password-check wording says what the code does.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Privacy from "./Privacy";
import PasswordCheck from "@/components/PasswordCheck";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Privacy section 16: referral disclosures", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => vi.stubEnv("VITE_REFERRALS_ENABLED", "true");
  it("qualifies the hash-only statement: lookup code, provider holds the address, unsubscribe link carries it", () => {
    on();
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("The hash is a lookup code, not anonymous");
    expect(text).toContain("we pass the address to our email provider");
    expect(text).toContain("The unsubscribe link in the email contains the address");
    expect(text).not.toContain("never the address itself");
  });

  it("says what the inviter sees: an email per friend who got a first report, and counts, never identity or results", () => {
    on();
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("the person who invited you is emailed that a friend they invited got their first report");
    expect(text).toContain("Their invite page shows only counts");
    expect(text).toContain("They are not told who you are or anything about your results.");
  });
});

describe("password check wording", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("explains a lookup identifier, not a scrambled code", () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    const { container } = render(<PasswordCheck />);
    const text = flat(container.textContent ?? "");
    expect(text).toContain("makes a one-way fingerprint of it (a SHA-1 hash)");
    expect(text).toContain("as a lookup identifier");
    expect(text).not.toContain("scrambled");
  });

  it("the Privacy sentence for the password check names a lookup identifier", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("a short lookup identifier made from your password");
    expect(text).not.toContain("scrambled password check");
  });
});

describe("the text matches the code", () => {
  it("the invite hash is an unsalted SHA-256 of the lower-cased address, and the unsubscribe link carries the address", () => {
    expect(readFileSync("workers/scan-report/lib/suppression.js", "utf8")).toContain("crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm(email)))");
    expect(readFileSync("workers/scan-report/lib/onboarding.js", "utf8")).toContain("/unsubscribe?e=${encodeURIComponent(email)}");
  });
});
