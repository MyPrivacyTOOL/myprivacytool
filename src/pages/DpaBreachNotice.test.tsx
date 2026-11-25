// MPC-11120 item 5: the DPA breach-notice line (Option A, chosen by Chris 2026-11-25). A draft for Legal; these tests pin what the line says.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import DPA from "./DPA";

const breachItem = () => {
  const li = screen.getAllByRole("listitem").find((el) => /personal data breach/i.test(el.textContent ?? ""));
  if (!li) throw new Error("breach-notice list item not found");
  return li;
};

describe("DPA breach-notice line (MPC-11120 item 5, Option A)", () => {
  it("says who tells whom, by what means, and what happens if 72 hours is missed", () => {
    renderPage(<DPA />);
    const text = (breachItem().textContent ?? "").replace(/\s+/g, " ").trim();
    expect(text).toContain("We will tell you without undue delay after we confirm a personal data breach affecting your data.");
    expect(text).toContain("We aim to do so within 72 hours of confirming it.");
    expect(text).toContain("If we cannot, we will tell you why.");
    expect(text).toContain("We will email the contact named in your agreement with us, or privacy@myprivacytool.io if none is named.");
  });

  it("no longer uses the old open-ended wording, and does not promise a hard 72 hours", () => {
    renderPage(<DPA />);
    const text = (breachItem().textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toContain("within 72 hours where we can");
    expect(text).not.toMatch(/\bwill (notify|tell) you within 72 hours\b/i);
  });

  it("links privacy@ as a mailto", () => {
    renderPage(<DPA />);
    const a = breachItem().querySelector("a");
    expect(a?.getAttribute("href")).toBe("mailto:privacy@myprivacytool.io");
  });
});
