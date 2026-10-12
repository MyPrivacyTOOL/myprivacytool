// MPC-7470 (D12): the saved-scan wording of record. Changing it needs Chris's written approval.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Privacy from "./Privacy";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Privacy: saved scan", () => {
  it("2.3 says a scan is saved only with the email and the box, for 12 months, and what is counted without personal data", () => {
    renderPage(<Privacy />);
    expect(screen.getByRole("heading", { name: "2.3 Your Saved Scan Result" })).toBeInTheDocument();
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain(
      "The free scan runs in your browser and shows you the results there. We do not save it unless you ask for your report. " +
        "When you enter your email address and tick the box to save your scan result, we save the full result, meaning the technical details your browser reported " +
        "such as IP address, device, browser, language, screen and fingerprint-style values, together with your email address, for 12 months, so your report can show it. " +
        "If you leave without giving an email address, nothing from the scan is saved. We only count, without personal data, how many visitors finish a scan and how many ask for a report, " +
        "through our analytics if you accepted analytics cookies.",
    );
  });

  it("2.0 and the retention line match; the old save-everything wording and the 90-day rule are gone", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("The finished result stays in your browser. It is not sent to us unless you ask for your report and choose to save it (see section 2.3).");
    expect(text).toContain("is kept for 12 months, then deleted automatically");
    expect(text).not.toMatch(/even if you never give us an email/i);
    expect(text).not.toMatch(/90 days after the scan/i);
    expect(text).not.toMatch(/accepted the consent banner, we also save/i);
  });

  it("keeps the email-check disclosure (Cloudflare: domain only; Gravatar: SHA-256 hash)", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("the domain part of your email address to Cloudflare");
    expect(text).toContain("a SHA-256 hash of your email address to Gravatar");
  });
});
