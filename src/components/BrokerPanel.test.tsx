// MPC-9814: every state of the broker section, rendered from the Worker's own panel builder. Synthetic data only.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BrokerPanel from "./BrokerPanel";
import { readBrokerPanel } from "@/lib/liveScan";
import { buildBrokerPanel } from "../../workers/scan-report/lib/brokerPanel.js";

const AT = { class: "free", provider: "user_supplied_page", method: "page_read", checked_at: "2026-11-07T10:00:00.000Z" };
const res = (key: string, state: string, extra: Record<string, unknown> = {}) => ({ key, name: key, state, match: null, confidence: null, is_guess: false, not_checked_reason: null, note: null, evidence_url: `https://${key}.example/p/1`, source: AT, ...extra });
const show = (items: unknown[], opts = { pasteAvailable: true }) => {
  const panel = readBrokerPanel(JSON.parse(JSON.stringify(buildBrokerPanel({ pending: false, items }, opts))))!;
  render(<MemoryRouter><BrokerPanel panel={panel} /></MemoryRouter>);
  return screen.getByTestId("broker-panel");
};
const li = (root: HTMLElement, key: string) => root.querySelector(`[data-broker="${key}"]`) as HTMLElement;

describe("broker section", () => {
  it("no page pasted: all nine in registry order, each Not checked with the plain reason and its guide; HK/SG and coverage lines", () => {
    const root = show([]);
    const rows = [...root.querySelectorAll("li")];
    expect(rows.map((r) => r.getAttribute("data-broker"))).toEqual(["spokeo", "whitepages", "beenverified", "truthfinder", "fastpeoplesearch", "mylife", "intelius", "whitepages_au", "truecaller"]);
    for (const r of rows) {
      expect(r.getAttribute("data-state")).toBe("not_checked");
      expect(r.querySelector('a[href^="/opt-out-guides/"]')).not.toBeNull();
      expect(r.textContent).toMatch(/Confidence: none, nothing was checked/);
    }
    expect(li(root, "spokeo").textContent).toContain("Not checked. We don't search broker sites for you. Paste a page that lists you, or paid coverage (coming) will check for you.");
    expect(li(root, "truecaller").textContent).toMatch(/needs you to sign in/);
    expect(screen.getByTestId("broker-region-note").textContent).toMatch(/Hong Kong and Singapore/);
    expect(root.textContent).toMatch(/Paid coverage .* is coming\. It is not live yet\./);
    expect(root.textContent).not.toMatch(/we (searched|found you)/i);
  });
  it("listed (exact): word + three-segment bar, evidence link, guide link", () => {
    const root = show([res("mylife", "listed", { match: "exact", confidence: "high" })]);
    const r = li(root, "mylife");
    expect(r.getAttribute("data-state")).toBe("listed");
    expect(r.textContent).toMatch(/We found a listing that matches what you told us \(an exact match/);
    expect(r.querySelector('[data-testid="confidence"]')?.textContent).toMatch(/Confidence: High/);
    expect(r.querySelectorAll('[data-testid="confidence"] span span.bg-foreground')).toHaveLength(3);
    expect(r.querySelector('a[href="https://mylife.example/p/1"]')?.textContent).toBe("Evidence: the page");
    expect(r.querySelector('a[href="/opt-out-guides/mylife"]')).not.toBeNull();
    expect(li(root, "spokeo").getAttribute("data-state")).toBe("not_checked"); // the others stay honest
  });
  it("listed (possible): labelled as a guess in words, Low confidence", () => {
    const r = li(show([res("intelius", "listed", { match: "possible", confidence: "low", is_guess: true })]), "intelius");
    expect(r.getAttribute("data-guess")).toBe("true");
    expect(r.textContent).toMatch(/Listed \(a guess\)/);
    expect(r.textContent).toMatch(/We are guessing: .* may be you\. Check it yourself/);
    expect(r.textContent).toMatch(/Confidence: Low/);
    expect(r.querySelectorAll('[data-testid="confidence"] span span.bg-foreground')).toHaveLength(1);
  });
  it("not listed: says it is about that one page, with the date and the evidence", () => {
    const r = li(show([res("spokeo", "not_listed", { note: "absent" })]), "spokeo");
    expect(r.getAttribute("data-state")).toBe("not_listed");
    expect(r.textContent).toMatch(/No match for the details you gave on the page you showed us, checked 2026-11-07\. This is about that one page only/);
    expect(r.textContent).toMatch(/Confidence: Medium/);
  });
  it("a pasted page that was blocked is Not checked, never Not listed", () => {
    const r = li(show([res("spokeo", "not_checked", { not_checked_reason: "fetch_blocked", note: "could_not_fetch" })]), "spokeo");
    expect(r.getAttribute("data-state")).toBe("not_checked");
    expect(r.textContent).toMatch(/the site would not let us read that page\. This is not a clear result/);
    expect(r.textContent).not.toMatch(/Not listed/);
  });
  it("a site outside the shortlist: its own row, 'no guide yet' with the general method", () => {
    const root = show([res("other", "listed", { name: "somewhere.example", match: "probable", confidence: "medium" })]);
    const rows = root.querySelectorAll("li");
    expect(rows).toHaveLength(10);
    const o = rows[9] as HTMLElement;
    expect(o.textContent).toMatch(/somewhere\.example/);
    expect(o.textContent).toMatch(/No guide yet for this site\. Here is the general method/);
    expect(o.querySelector('a[href="/opt-out-guides"]')).not.toBeNull();
  });
  it("paste not available (check switched off): never invites a paste", () => {
    const root = show([], { pasteAvailable: false });
    expect(root.textContent).not.toMatch(/Paste a page/i);
    expect(li(root, "spokeo").textContent).toMatch(/paid coverage \(coming\) will check for you/);
  });
  it("drops a malformed panel", () => {
    expect(readBrokerPanel({ rows: [{ state: "bogus" }], intro: "x" })).toBeNull();
    expect(readBrokerPanel("junk")).toBeNull();
  });
});
