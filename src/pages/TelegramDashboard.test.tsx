// MPC-7893: the Telegram dashboard page. Synthetic API answers only. Checks the honest states, the /scan call to action on every view,
// that nothing is fetched except /api/dashboard, and that keyboard users can reach the views.
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import TelegramDashboard from "./TelegramDashboard";

afterEach(() => vi.unstubAllGlobals());

const hexagons = [
  { id: "tg.username", label: "@username", arrival_label: "Sent with every message", state: "returned", value: "@synthetic_user", value_note: null },
  { id: "tg.language", label: "Language setting", arrival_label: "Sent with every message", state: "returned", value: null, value_note: "Received when you confirmed, but not kept in the stored scan." },
  { id: "tg.bio", label: "Bio", arrival_label: "Public profile lookup", state: "not_returned", value: null, value_note: null, explain: "Good news: Telegram did not send this to the bot, so nothing was exposed through this check. Either your privacy settings are blocking it, or it is not set on your profile. The bot cannot tell which." },
  { id: "tg.premium", label: "Premium status", arrival_label: "Public profile lookup", state: "not_checked", value: null, value_note: null, explain: "This scan does not look this up yet, so we cannot say whether it is exposed. A check for it has not been built." },
];
const base = {
  generated_at: "2026-10-26T15:00:00Z",
  baseline: { state: "available", taken_at: "2026-10-26T14:00:00Z", scan_version: "telegram-baseline-1", risk_version: "risk-count-1", schema_version: 1, risk: { returned: 1, possible: 30, notChecked: 1, percent: 3, band: "low", label: "Low exposure" }, hexagons, insights: [], never_sent: ["last seen"], disabled: {}, limits: ["Not proof of privacy."] },
  enhanced: { state: "not_run", note: "DEEP has not been run.", limits: ["A username match is not identity."] },
  final: { state: "not_run", note: "No re-check yet.", self_reported: { recorded: false, note: "No self-reported actions are recorded." } },
  cta: { href: "/scan", label: "Run a full scan on the website" },
  deep_reminder: "To run the DEEP check, go back to Telegram and type DEEP. Opening this page does not run it.",
};

describe("TelegramDashboard", () => {
  it("shows the baseline with versions, states as text, never-sent wins, limits and the /scan call to action; fetches only /api/dashboard", async () => {
    const f = vi.fn(async () => jsonResponse(base));
    vi.stubGlobal("fetch", f);
    renderPage(<TelegramDashboard />, "/dashboard");
    expect(await screen.findByText(/1 of 30/)).toBeTruthy();
    expect(screen.getByText(/risk risk-count-1/)).toBeTruthy();
    expect(screen.getAllByText("Received by the bot").length).toBe(2);
    expect(screen.getByTestId("value-tg.username").textContent).toBe("@synthetic_user"); // the person's own data is shown, not just a label
    expect(screen.getByText(/not kept in the stored scan/)).toBeTruthy();
    expect(screen.queryByTestId("value-tg.bio")).toBeNull(); // not returned: no value
    // every "not returned" and "not checked" item says why, in plain words, and the good news is not stated as a fact about the person's settings
    expect(screen.getByTestId("explain-tg.bio").textContent).toMatch(/Good news: Telegram did not send this to the bot/);
    expect(screen.getByTestId("explain-tg.bio").textContent).toMatch(/Either your privacy settings are blocking it, or it is not set on your profile/);
    expect(screen.getByText("Not returned: good")).toBeTruthy();
    expect(screen.getByTestId("explain-tg.premium").textContent).toMatch(/does not look this up yet/);
    expect(screen.getByText("Not checked")).toBeTruthy();
    expect(screen.getByText(/Never sent to bots by Telegram: last seen/)).toBeTruthy();
    expect(screen.getByText("Not proof of privacy.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Run a full scan on the website" }).getAttribute("href")).toBe("/scan");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/dashboard");
    expect(init.cache).toBe("no-store");
  });

  it("Enhanced and Final show honest not-run states with the DEEP reminder, each ending in the /scan call to action, reachable by keyboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(base)));
    const user = userEvent.setup();
    renderPage(<TelegramDashboard />, "/dashboard");
    await screen.findByText(/1 of 30/);
    const tabs = screen.getByRole("tablist", { name: "Dashboard views" });
    within(tabs).getByRole("tab", { name: "Baseline" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(tabs).getByRole("tab", { name: "Enhanced" }));
    await user.keyboard("{Enter}");
    expect(await screen.findByText("DEEP has not been run.")).toBeTruthy();
    expect(screen.getByText(/type DEEP/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Run a full scan on the website" })).toBeTruthy();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(await screen.findByText("No re-check yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Run a full scan on the website" })).toBeTruthy();
  });

  it("renders partial DEEP results with the identity caveat, and incomparable re-checks without claiming closed gaps", async () => {
    const data = {
      ...base,
      enhanced: { state: "partial", note: "The DEEP check finished only in part.", started_at: "2026-10-26T15:00:00Z", finished_at: null, detector_version: "deep-1", limits: ["A username match is not identity."], results: [{ source: "gh", site_name: "GitHub", status: "found", observed_at: "2026-10-26T15:00:01Z", limitation: "Same name is not the same person." }, { source: "rd", site_name: "Reddit", status: "blocked", observed_at: "2026-10-26T15:00:02Z", limitation: "Blocked is not an all-clear." }] },
      final: { state: "incomparable", baseline_at: "2026-10-26T14:00:00Z", recheck_at: "2026-10-27T10:00:00Z", reasons: ["risk version risk-count-1 vs risk-rank-1"], note: "These two scans were made with different versions.", self_reported: { recorded: false, note: "No self-reported actions are recorded." } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(data)));
    const user = userEvent.setup();
    renderPage(<TelegramDashboard />, "/dashboard");
    await screen.findByText(/1 of 30/);
    await user.click(screen.getByRole("tab", { name: "Enhanced" }));
    expect(await screen.findByText("Username found")).toBeTruthy();
    expect(screen.getByText("Blocked by the site")).toBeTruthy();
    expect(screen.getByText("A username match is not identity.")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Final" }));
    expect(await screen.findByText(/different versions/)).toBeTruthy();
    expect(screen.getByText(/risk version risk-count-1 vs risk-rank-1/)).toBeTruthy();
    expect(screen.queryByText(/closed/i)).toBeNull();
  });

  it.each([[401, /fresh link/], [410, /no longer stored/], [503, /not available right now/]])("answer %i shows a plain message and no data", async (status, text) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "x" }, status)));
    renderPage(<TelegramDashboard />, "/dashboard");
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("Help is available as plain text and triggers nothing", async () => {
    const f = vi.fn(async () => jsonResponse(base));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<TelegramDashboard />, "/dashboard");
    await screen.findByText(/1 of 30/);
    await user.click(screen.getByText("Help"));
    expect(screen.getByText(/does not scan anything, run DEEP, send a message or sign you up/)).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
