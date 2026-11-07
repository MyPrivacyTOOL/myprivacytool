// MPC-9828 (F8): a legal page must be true on the day it is read. Until F3 (accounts and Stripe billing) is live, no legal page may
// state Stripe, accounts, billing, cancellation or refunds as a present fact; and no legal page carries a status marker.
import { describe, it, expect } from "vitest";
import { renderPage } from "@/test/render";
import { FEATURE_STATUS } from "@/config/featureStatus";
import Privacy from "./Privacy";
import Cookies from "./Cookies";
import Terms from "./Terms";
import DPA from "./DPA";
import AcceptableUse from "./AcceptableUse";

const PAGES: Array<[string, () => JSX.Element]> = [
  ["/privacy", () => <Privacy />],
  ["/cookies", () => <Cookies />],
  ["/terms", () => <Terms />],
  ["/dpa", () => <DPA />],
  ["/acceptable-use", () => <AcceptableUse />],
];
const FUTURE = /when paid plans open|before paid plans go live|planned|expect|not (yet )?open|not available today|none of it applies today|we hold none today|we do not have user accounts/i;
const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=\.)\s+/);

describe("legal pages: Stripe and billing are never present tense before F3 is live", () => {
  const live = FEATURE_STATUS.F3 === "live";
  it.each(PAGES)("%s names Stripe only in future or planned wording", (_p, el) => {
    if (live) return;
    renderPage(el());
    const text = document.body.textContent ?? "";
    for (const s of sentences(text).filter((x) => /stripe/i.test(x))) {
      expect(s, `present-tense Stripe: "${s}"`).toMatch(FUTURE);
    }
  });

  it("/cookies lists no Stripe cookie", () => {
    if (live) return;
    renderPage(<Cookies />);
    const li = [...document.querySelectorAll("li")].map((e) => e.textContent ?? "");
    expect(li.filter((t) => /stripe/i.test(t))).toEqual([]);
  });

  it("/terms does not describe billing, cancellation in account settings or a 14-day refund as live", () => {
    if (live) return;
    renderPage(<Terms />);
    const t = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).not.toMatch(/account settings/i);
    expect(t).not.toMatch(/14 days of purchase/i);
    expect(t).not.toMatch(/renews automatically/i);
    expect(t).not.toMatch(/we charge the payment method on file/i);
    expect(t).toContain("Paid plans are not open today.");
  });

  it("/privacy does not list payment or account data as held today, and names the planned vendor as not active", () => {
    if (live) return;
    renderPage(<Privacy />);
    const t = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).not.toMatch(/Retained for the duration of your subscription/i);
    expect(t).not.toMatch(/Billing address, payment method/i);
    expect(t).toContain("Partners We Are Considering");
    expect(t).toMatch(/planned and not yet active/);
  });

  it.each(["/terms", "/cookies"] as const)("%s carries no FeatureStatus marker except on the blocked IP sentence", (p) => {
    renderPage(p === "/terms" ? <Terms /> : <Cookies />);
    const marks = [...document.querySelectorAll("[data-feature-status]")].map((e) => e.getAttribute("data-feature"));
    expect(marks.filter((m) => m !== "F8")).toEqual([]);
  });
});
