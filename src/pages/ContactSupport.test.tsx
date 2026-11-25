// MPC-9808 (SUPPORT-001): /contact names the support address and says when to expect a reply. Chris's decision 2026-11-18 (Q6): publish only once someone is confirmed to monitor support@.
import { describe, it, expect } from "vitest";
import { renderPage } from "@/test/render";
import Contact from "./Contact";

describe("/contact support channel", () => {
  it("lists support@ as a mailto link and states the reply time", () => {
    renderPage(<Contact />);
    expect(document.querySelector('a[href="mailto:support@myprivacytool.io"]')).not.toBeNull();
    expect((document.body.textContent ?? "").replace(/\s+/g, " ")).toContain("We reply within 2 business days (Hong Kong time).");
  });

  it("still lists the four existing mailboxes", () => {
    renderPage(<Contact />);
    for (const a of ["privacy", "dpo", "legal", "accessibility"]) expect(document.querySelector(`a[href="mailto:${a}@myprivacytool.io"]`)).not.toBeNull();
  });
});
