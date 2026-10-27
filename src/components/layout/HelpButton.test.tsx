import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";
import Layout from "./Layout";
import CookieBanner from "@/components/CookieBanner";
import HelpButton, { AI_SUPPORT_AVAILABLE } from "./HelpButton";
import { FAQS } from "@/data/faqs";
import * as analytics from "@/lib/analytics";

vi.mock("@/components/MatrixRain", () => ({ default: () => null }));

// MPC-8527: route patterns come from the real App.tsx so a newly registered route is covered automatically.
const appSource = readFileSync("src/App.tsx", "utf8");
const PATTERNS = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
// Safe fixtures only: no real slug, report token or customer record.
const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, "test-fixture").replace(/^\*$/, "/no-such-page");

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const renderAt = (route: string, child = <Where />) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={child} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: false, at: "2026-01-01T00:00:00.000Z" })));
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("HELP on every registered route (MPC-8527)", () => {
  it("finds the registered routes", () => {
    expect(PATTERNS.length).toBeGreaterThan(30);
    expect(PATTERNS).toContain("*");
    expect(PATTERNS).toContain("/blog/:slug");
  });

  it.each(PATTERNS.map((p) => [p, concrete(p)]))("route %s (%s) shows exactly one HELP button", (_p, path) => {
    renderAt(path);
    expect(screen.getAllByRole("button", { name: "Help" })).toHaveLength(1);
  });

  it("is outside the mobile menu: the menu is closed and HELP is already in the header", () => {
    renderAt("/scan");
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByRole("button", { name: "Help" })).toBeVisible();
  });

  it("is present while a lazy route is still loading (Suspense fallback) and on the 404 page", async () => {
    const Never = () => { throw new Promise(() => {}); };
    renderAt("/report", <Never />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    const { default: NotFound } = await import("@/pages/NotFound");
    renderAt("/no-such-page", <NotFound />);
    expect(screen.getAllByRole("button", { name: "Help" }).length).toBeGreaterThan(0);
  });
});

describe("HELP panel", () => {
  it("opens with the keyboard, has a title and a focus-return on Escape", async () => {
    const user = userEvent.setup();
    renderAt("/faq");
    const btn = screen.getByRole("button", { name: "Help" });
    await user.tab();
    btn.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(dialog).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("offers existing FAQ answers verbatim and links to /faq and /contact", async () => {
    const user = userEvent.setup();
    renderAt("/scan");
    await user.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog", { name: "Help" });
    const q = "How does the scan work?";
    const faq = FAQS.find((f) => f.q === q)!;
    expect(within(dialog).getByText(q)).toBeInTheDocument();
    expect(within(dialog).getByText(faq.a)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "All questions" })).toHaveAttribute("href", "/faq");
    expect(within(dialog).getByRole("link", { name: "Contact page" })).toHaveAttribute("href", "/contact");
  });

  it("navigates in-app (no reload) and closes the panel", async () => {
    const user = userEvent.setup();
    renderAt("/scan");
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("link", { name: "All questions" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/faq");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is honest that AI support is unavailable: no chat box, no case form, no promised reply", async () => {
    expect(AI_SUPPORT_AVAILABLE).toBe(false);
    const user = userEvent.setup();
    renderAt("/report");
    await user.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(within(dialog).getByTestId("help-ai-status")).toHaveTextContent("We don't have an AI assistant");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("form")).toBeNull();
    expect(dialog.textContent).toMatch(/does not open a support case/);
    expect(dialog.textContent).not.toMatch(/within \d+|24 ?h|agent|we'll reply|we will reply|ticket created/i);
  });

  it("does not send anything or put report data in analytics when opened", async () => {
    const user = userEvent.setup();
    const track = vi.spyOn(analytics, "trackEvent");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderAt("/report?token=SECRET-TOKEN&email=a@b.co");
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("help_opened");
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/SECRET-TOKEN|a@b\.co/);
    vi.unstubAllGlobals();
  });
});

describe("state preservation and overlays", () => {
  it("keeps typed form text and the page instance while HELP opens and closes", async () => {
    const user = userEvent.setup();
    const Form = () => {
      const [n, setN] = useState(0);
      return (
        <form onSubmit={(e) => e.preventDefault()}>
          <label>Your email<input defaultValue="" /></label>
          <button type="button" onClick={() => setN(n + 1)}>scan {n}</button>
        </form>
      );
    };
    renderAt("/scan", <Form />);
    await user.type(screen.getByLabelText("Your email"), "typed@example.com");
    await user.click(screen.getByRole("button", { name: "scan 0" }));
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Your email")).toHaveValue("typed@example.com");
    expect(screen.getByRole("button", { name: "scan 1" })).toBeInTheDocument();
  });

  it("does not hide the cookie banner buttons: both stay reachable with HELP present", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
        <CookieBanner />
      </MemoryRouter>,
    );
    // HELP lives in the sticky header, the banner at the bottom: they never share a screen edge.
    expect(screen.getByRole("button", { name: "Help" }).closest("header")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Accept analytics" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Essential only" }));
    expect(screen.queryByText("Your privacy, your choice")).toBeNull();
  });

  it("renders standalone too", () => {
    render(<MemoryRouter><HelpButton /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });
});
