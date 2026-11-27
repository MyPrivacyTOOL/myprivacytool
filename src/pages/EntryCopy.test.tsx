// MPC-9804 (EXT-17): the entry pages say what the product is in one literal sentence before the hexagon instructions, do not use the old
// "Get clean" headline (Chris's Q12 decision, 2026-11-18), and /scan says only what the listing check really does (a page the visitor shows us).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Index from "./Index";
import Journey from "./Journey";
import Scan from "./Scan";

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const HEADLINE = "See what's out there about you, and what an AI agent could find.";

describe("entry page copy (MPC-9804)", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
  });

  it("home: one product sentence comes first in the introduction, before any hexagon instruction", () => {
    renderPage(<Index />);
    const intro = screen.getByLabelText("Introduction");
    const first = intro.querySelector("p");
    expect(first).toBe(screen.getByTestId("product-sentence"));
    expect(flat(first?.textContent)).toBe("MyPrivacyTOOL shows you what any website can learn about you from your browser and device, and what you can do about it.");
    expect(flat(first?.textContent)).not.toMatch(/hexagon|click|tap/i);
  });

  it("home and /journey use the bounded headline, never 'Get clean', and never imply certification", () => {
    const home = renderPage(<Index />);
    expect(screen.getByRole("heading", { name: HEADLINE })).toBeInTheDocument();
    expect(flat(document.body.textContent)).not.toMatch(/get clean/i);
    home.unmount();
    renderPage(<Journey />);
    expect(screen.getByRole("heading", { level: 1, name: HEADLINE })).toBeInTheDocument();
    expect(flat(document.body.textContent)).not.toMatch(/get clean|certif|guarantee/i);
  });

  it("/scan: does not promise a search of broker sites; says the check is of a page the visitor shows", () => {
    renderPage(<Scan />);
    const text = flat(document.body.textContent);
    expect(text).toContain("We do not search broker sites for you yet. If you show us a page that lists you, we check it");
    expect(text).not.toMatch(/Check your exposure to see where your information may be listed/);
  });
});
