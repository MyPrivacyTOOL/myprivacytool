// MPC-9816 acceptance tests AT-1, AT-2, AT-3, AT-14 (spec docs/paid-report-spec-mpc-9815.md s6) against the rendered /report page.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import Report from "./Report";
import plans from "@/data/plans.generated.json";

const view = () => render(<MemoryRouter><Report /></MemoryRouter>).container;
const dollars = (c: number) => `$${Number.isInteger(c / 100) ? c / 100 : (c / 100).toFixed(2)}`;

describe("/report (MPC-9816)", () => {
  it("AT-1: none of the retired claims remain", () => {
    const t = view().textContent ?? "";
    for (const bad of ["$9/", "$79", "Annual Protection", "See Everything", "Remove Everything", "One-click removal", "Automated Removal", "Dark web"]) expect(t).not.toContain(bad);
  });
  it("AT-2: every price shown equals the plans data, and none is typed in the page source", () => {
    const shown = (view().textContent ?? "").match(/\$\d+(?:\.\d\d)?/g) ?? [];
    const allowed = new Set(plans.map((p) => dollars(p.monthly_price_cents)));
    expect(shown.length).toBeGreaterThan(0);
    for (const s of shown) expect(allowed.has(s)).toBe(true);
    expect(readFileSync("src/pages/Report.tsx", "utf8")).not.toMatch(/\$\d/);
  });
  it("AT-3 / AT-14: removal, monitoring, breach, history and export claims carry a badge", () => {
    const c = view();
    const li = (needle: string) => [...c.querySelectorAll("li")].find((x) => x.textContent?.includes(needle))!;
    for (const needle of ["Breaches", "Every scan kept", "PDF and JSON", "monthly re-scan", "managed removal", "Licensed coverage"]) {
      expect(li(needle).querySelector("[data-feature-status]"), needle).not.toBeNull();
    }
  });
  it("states the honest line and does not claim a checkout that does not exist", () => {
    const t = view().textContent ?? "";
    expect(t).toContain('never "clear"');
    expect(t).toContain("Join the list");
  });
});
