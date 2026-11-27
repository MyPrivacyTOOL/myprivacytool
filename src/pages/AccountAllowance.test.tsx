// MPC-9818: the account page shows the plan's scan allowance in words, and says what a Free plan does not list (kept, not deleted). SYNTHETIC identity only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { jsonResponse } from "@/test/render";
import Account from "./Account";
import { requestScanReport, ReportRequestError } from "@/lib/scanReport";

const EMAIL = "zelda.test+9818@example.test";
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubEnv("VITE_ACCOUNTS_ENABLED", "true"); localStorage.setItem("mpt_account_session", JSON.stringify({ accessToken: "at_1", refreshToken: "rt_1", expiresAt: 9999999999 })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const withMe = (plan: string, entScans: Record<string, unknown>, history: Record<string, unknown>) =>
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ account: { email: EMAIL, plan, created_at: "2026-11-08T01:00:00Z", keep_scans: true }, scans: [], history, entitlements: { tier: plan, scans: entScans } })));
const open = () => render(<MemoryRouter initialEntries={["/account"]}><Routes><Route path="/account" element={<Account />} /></Routes></MemoryRouter>);

describe("account page: allowance", () => {
  it("Free: says how many scans are used this month and when it resets; older scans are kept, not deleted", async () => {
    withMe("free", { limit: 1, used: 1, remaining: 0, unlimited: false, resets_at: "2026-12-01T00:00:00.000Z" }, { full: false, older_kept: 2 });
    open();
    expect(await screen.findByTestId("account-allowance")).toHaveTextContent("1 of 1 used this month, resets 1 December");
    expect(screen.getByTestId("older-kept")).toHaveTextContent(/2 older scans are saved and not deleted/i);
  });
  it("Executive: 'Unlimited scans' and nothing else (no cap, no fair-use text)", async () => {
    withMe("executive", { limit: null, used: 40, remaining: null, unlimited: true, resets_at: "2026-12-01T00:00:00.000Z" }, { full: true, older_kept: 0 });
    open();
    const el = await screen.findByTestId("account-allowance");
    expect(el.textContent).toBe("Unlimited scans");
    expect(screen.queryByTestId("older-kept")).toBeNull();
    expect(document.body.textContent).not.toMatch(/fair.use/i);
  });
});

describe("scan request: allowance refusal", () => {
  it("a 429 with the allowance code carries the Worker's own explanation; a plain 429 stays 'rate_limited'", async () => {
    const message = "You've used this month's free scan. Sign up for 5 a month on Basic. Your allowance comes back on 1 December. See the plans at myprivacytool.io/pricing.";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Monthly scan allowance used", code: "scan_allowance_exhausted", message }, 429)));
    const e1 = await requestScanReport("a@example.test", false, false).catch((e) => e);
    expect(e1).toBeInstanceOf(ReportRequestError);
    expect(e1.kind).toBe("allowance");
    expect(e1.detail).toBe(message);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Too many requests" }, 429)));
    const e2 = await requestScanReport("a@example.test", false, false).catch((e) => e);
    expect(e2.kind).toBe("rate_limited");
    expect(e2.detail).toBeUndefined();
  });
});
