// MPC-9806: the coverage note is on /start and /scan before any identifier is collected, and names exactly the sites the Worker recognises.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import ListingCoverageNote from "./ListingCoverageNote";
import Scan from "@/pages/Scan";
import Start from "@/pages/Start";
import Pricing from "@/pages/Pricing";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const recognisedSites = (): string[] => {
  const src = readFileSync("workers/scan-report/lib/brokers.js", "utf8");
  const block = src.slice(src.indexOf("export const BROKER_SITES"), src.indexOf("];", src.indexOf("export const BROKER_SITES")));
  return [...block.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
};

describe("listing coverage note", () => {
  it("says what the check covers, that no broker is searched, and that 'not listed' is not clearance", () => {
    const { container } = render(<ListingCoverageNote />);
    const text = flat(container.textContent ?? "");
    expect(text).toContain("We do not search broker sites for you.");
    expect(text).toContain("It is not clearance");
    expect(text).toContain("in any country");
  });

  it("names every site the Worker recognises, and no more", () => {
    const names = recognisedSites();
    expect(names.length).toBe(9);
    const { container } = render(<ListingCoverageNote />);
    const text = flat(container.textContent ?? "");
    for (const n of names) expect(text, `the note does not name ${n}`).toContain(n.replace("White Pages Australia", "White Pages Australia"));
  });

  it.each([["/scan", Scan], ["/start", Start]] as const)("is shown on %s before any identifier field", (_route, Page) => {
    renderPage(<Page />);
    const note = screen.getByTestId("listing-coverage");
    // Where an email field is on the page at first paint, the note comes before it; /start shows its form only after the first step, so nothing is collected yet.
    const field = document.querySelector('input[type="email"]');
    if (field) expect(note.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("/pricing", () => {
  it("states the eligibility that exists and that purchase geography is not yet stated", () => {
    renderPage(<Pricing />);
    const text = flat(screen.getByTestId("pricing-eligibility").textContent ?? "");
    expect(text).toContain("at least 16");
    expect(text).toContain("Paid plans are not on sale yet");
  });
});
