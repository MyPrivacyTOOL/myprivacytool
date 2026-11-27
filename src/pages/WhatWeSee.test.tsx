// MPC-9893: /what-we-see is a static render of shared/recipients/recipients.json.
import { describe, it, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import { renderPage } from "@/test/render";
import WhatWeSee from "./WhatWeSee";
import { RECIPIENT_LIST, RECIPIENTS } from "@/config/recipients";
import { registryHash } from "../../shared/recipients/canonical.js";
import { isLive, isRemoved, registryDate } from "../../shared/recipients/disclosure";

const TODAY = "2026-11-09";

describe("/what-we-see", () => {
  it("lists one row per live registry entry, grouped by party, and nothing else", () => {
    renderPage(<WhatWeSee today={TODAY} />, "/what-we-see");
    const rows = screen.getAllByTestId("recipient-row");
    const live = RECIPIENT_LIST.filter((r) => isLive(r, TODAY));
    expect(rows).toHaveLength(live.length);
    expect(rows.map((r) => r.getAttribute("data-recipient")).sort()).toEqual(live.map((r) => r.key).sort());
    for (const party of ["first", "third"]) expect(screen.getByTestId(`group-${party}`)).toBeInTheDocument();
  });

  it("shows when each runs: page load for pre-click entries, only after Scan me for the rest", () => {
    renderPage(<WhatWeSee today={TODAY} />, "/what-we-see");
    for (const row of screen.getAllByTestId("recipient-row")) {
      const phase = row.getAttribute("data-phase");
      expect(within(row).getByTestId("recipient-when").textContent).toBe(phase === "pre_click" ? "when the page loads" : "only after you press Scan me");
    }
  });

  it("lists ended entries in a removed section with their until date, not among the live ones", () => {
    renderPage(<WhatWeSee today={TODAY} />, "/what-we-see");
    const removed = RECIPIENT_LIST.filter((r) => isRemoved(r, TODAY));
    expect(removed.length).toBeGreaterThan(0);   // google-fonts ended 2026-11-08 (MPC-9886)
    const rows = screen.getAllByTestId("removed-row");
    expect(rows).toHaveLength(removed.length);
    for (const r of removed) {
      const row = rows.find((x) => x.getAttribute("data-recipient") === r.key)!;
      expect(row.textContent).toContain(`ended ${r.until}`);
      expect(screen.getAllByTestId("recipient-row").some((x) => x.getAttribute("data-recipient") === r.key)).toBe(false);
    }
  });

  it("shows the registry date and the SHA-256 of the registry file", async () => {
    renderPage(<WhatWeSee today={TODAY} />, "/what-we-see");
    expect(screen.getByTestId("registry-date").textContent).toBe(registryDate(RECIPIENT_LIST));
    const want = await registryHash(RECIPIENTS);
    await waitFor(() => expect(screen.getByTestId("registry-hash").textContent).toBe(want));
  });

  it("renders in the language asked for, right-to-left for Arabic, and says the reasons are still English", () => {
    renderPage(<WhatWeSee today={TODAY} />, "/what-we-see?lang=ar");
    expect(screen.getByTestId("what-we-see")).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("what-we-see")).toHaveAttribute("lang", "ar");
    expect(screen.getAllByTestId("recipient-when")[0].textContent).toMatch(/[؀-ۿ]/);
    expect(screen.getByTestId("what-we-see-fallback")).toBeInTheDocument();
  });
});
