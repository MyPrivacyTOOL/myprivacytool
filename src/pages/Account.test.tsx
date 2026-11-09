// MPC-9817: /account and /account/verify. SYNTHETIC identity only (example.test); the Worker is a stub that applies the same rules as lib/accounts.js.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";
import { jsonResponse } from "@/test/render";
import Account from "./Account";
import AccountVerify from "./AccountVerify";
import { ACCOUNT_CONSENT_LABEL, ACCOUNT_CONSENT_VERSION, SAVE_CONSENT_LABEL, SAVE_CONSENT_VERSION, activeSaveLabel, activeSaveVersion } from "@/lib/saveConsent";

const SCAN = "11111111-2222-4333-8444-555555555555";
const EMAIL = "zelda.test+9817@example.test";
const app = (route: string) => render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/account" element={<Account />} /><Route path="/account/verify" element={<AccountVerify />} /></Routes></MemoryRouter>);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubEnv("VITE_ACCOUNTS_ENABLED", "true"); window.location.hash = ""; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function worker(over: Record<string, (body: Record<string, unknown> | undefined, auth: string | null) => { status: number; body: unknown }> = {}) {
  const calls: { path: string; body?: Record<string, unknown>; auth: string | null }[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).split("/api/account/")[1];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const auth = ((init?.headers as Record<string, string> | undefined)?.Authorization ?? null);
    calls.push({ path, body, auth });
    const h = over[path];
    if (h) { const r = h(body, auth); return jsonResponse(r.body, r.status); }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", f);
  return { calls, f };
}
const session = { session: { access_token: "at_1", refresh_token: "rt_1", expires_at: 9999999999 }, account: { email: EMAIL, plan: "free" }, scan_attached: true };
const me = (scans = [{ scan_number: SCAN, created_at: "2026-11-08T01:00:00Z", hexagon_count: 5 }]) => ({ status: 200, body: { account: { email: EMAIL, plan: "free", created_at: "2026-11-08T01:00:00Z", keep_scans: true }, scans } });

describe("sign-in page", () => {
  it("signed out: asks for an email only (no password field) and says a link was sent without revealing whether the address has an account", async () => {
    const w = worker({ signin: () => ({ status: 200, body: { sent: true } }) });
    const user = userEvent.setup();
    app("/account");
    await screen.findByTestId("signin-form");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await user.type(screen.getByLabelText("Email address"), EMAIL);
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    expect(await screen.findByTestId("sent")).toHaveTextContent(/if that address can receive email/i);
    expect(w.calls[0].path).toBe("signin");
    expect(w.calls[0].body).toMatchObject({ email: EMAIL });
  });
  it("sends the scan number held in this browser, so the current scan is attached at sign-in", async () => {
    localStorage.setItem("mpt_web_scan_number", SCAN);
    const w = worker({ signin: () => ({ status: 200, body: { sent: true } }) });
    const user = userEvent.setup();
    app("/account");
    await user.type(await screen.findByLabelText("Email address"), EMAIL);
    await user.click(screen.getByRole("button", { name: /email me/i }));
    await screen.findByTestId("sent");
    expect(w.calls[0].body).toMatchObject({ scan_number: SCAN });
  });
  it("a failed request says so honestly", async () => {
    worker({ signin: () => ({ status: 503, body: {} }) });
    const user = userEvent.setup();
    app("/account");
    await user.type(await screen.findByLabelText("Email address"), EMAIL);
    await user.click(screen.getByRole("button", { name: /email me/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not send/i);
  });
  it("is off (no form, no calls) while VITE_ACCOUNTS_ENABLED is not true", async () => {
    vi.stubEnv("VITE_ACCOUNTS_ENABLED", "false");
    const w = worker();
    app("/account");
    expect(await screen.findByText(/not open yet/i)).toBeInTheDocument();
    expect(w.f).not.toHaveBeenCalled();
  });
});

describe("the emailed link", () => {
  it("needs one deliberate press: opening the page alone calls nothing", async () => {
    window.location.hash = `#t=${"a".repeat(32)}&n=${SCAN}`;
    const w = worker();
    app("/account/verify");
    expect(await screen.findByTestId("signin-button")).toBeInTheDocument();
    expect(w.f).not.toHaveBeenCalled();
  });
  it("pressing Sign in redeems the token (with the scan number), keeps the session and lands on /account", async () => {
    window.location.hash = `#t=${"a".repeat(32)}&n=${SCAN}`;
    const w = worker({ verify: () => ({ status: 200, body: session }), me: () => me() });
    const user = userEvent.setup();
    app("/account/verify");
    await user.click(await screen.findByTestId("signin-button"));
    expect(await screen.findByTestId("account-view")).toBeInTheDocument();
    expect(w.calls[0]).toMatchObject({ path: "verify", body: { token_hash: "a".repeat(32), scan_number: SCAN } });
    expect(JSON.parse(localStorage.getItem("mpt_account_session")!)).toMatchObject({ accessToken: "at_1", refreshToken: "rt_1" });
  });
  it("an expired or used link says so and offers a new one", async () => {
    window.location.hash = `#t=${"b".repeat(32)}`;
    worker({ verify: () => ({ status: 401, body: { error: "Invalid or expired" } }) });
    const user = userEvent.setup();
    app("/account/verify");
    await user.click(await screen.findByTestId("signin-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired or was already used/i);
    expect(localStorage.getItem("mpt_account_session")).toBeNull();
  });
  it("a link without a token is not usable", async () => {
    worker();
    app("/account/verify");
    expect(await screen.findByRole("alert")).toHaveTextContent(/not complete/i);
  });
});

describe("the account page", () => {
  const signedIn = () => localStorage.setItem("mpt_account_session", JSON.stringify({ accessToken: "at_1", refreshToken: "rt_1", expiresAt: null }));
  it("shows email, plan (read-only) and the scans list with number, date and Open", async () => {
    signedIn();
    const w = worker({ me: () => me(), scan: () => ({ status: 200, body: { scan: { results: [{ label: "IP address", value: "203.0.113.9", confidence: 90 }] } } }) });
    const user = userEvent.setup();
    app("/account");
    expect(await screen.findByTestId("account-email")).toHaveTextContent(EMAIL);
    expect(screen.getByTestId("account-plan")).toHaveTextContent("Free");
    expect(document.querySelector('[data-testid="account-plan"] input, [data-testid="account-plan"] select')).toBeNull();
    const row = screen.getByTestId("scan-row");
    expect(row).toHaveTextContent(SCAN); expect(row).toHaveTextContent("2026-11-08");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByTestId("scan-results")).toHaveTextContent("IP address: 203.0.113.9");
    expect(w.calls.find((c) => c.path === "scan")?.auth).toBe("Bearer at_1");
  });
  it("an expired access token is refreshed once, then the page loads", async () => {
    signedIn();
    let meCalls = 0;
    worker({ me: () => (++meCalls === 1 ? { status: 401, body: {} } : me()), refresh: () => ({ status: 200, body: { session: { access_token: "at_2", refresh_token: "rt_2" } } }) });
    app("/account");
    expect(await screen.findByTestId("account-view")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("mpt_account_session")!).accessToken).toBe("at_2");
  });
  it("a dead session returns to the sign-in form and clears the stored session", async () => {
    signedIn();
    worker({ me: () => ({ status: 401, body: {} }), refresh: () => ({ status: 401, body: {} }) });
    app("/account");
    expect(await screen.findByTestId("signin-form")).toBeInTheDocument();
    expect(localStorage.getItem("mpt_account_session")).toBeNull();
  });
  it("claim by scan number: says plainly when it does not match", async () => {
    signedIn();
    worker({ me: () => me([]), "link-scan": () => ({ status: 200, body: { linked: false } }) });
    const user = userEvent.setup();
    app("/account");
    await screen.findByTestId("no-scans");
    await user.type(screen.getByLabelText(/add an earlier scan/i), SCAN);
    await user.click(screen.getByRole("button", { name: "Add scan" }));
    expect(await screen.findByText(/could not match that number to your email/i)).toBeInTheDocument();
  });
  it("delete needs a second deliberate press, then deletes (not unlinks) and signs out", async () => {
    signedIn();
    const w = worker({ me: () => me(), delete: () => ({ status: 200, body: { deleted: true, account_deleted: true, scans_deleted: 1, sign_in_removed: true } }) });
    const user = userEvent.setup();
    app("/account");
    await screen.findByTestId("account-view");
    await user.click(screen.getByRole("button", { name: /delete my account and all scans/i }));
    expect(w.calls.some((c) => c.path === "delete")).toBe(false);
    await user.click(await screen.findByTestId("confirm-delete"));
    expect(await screen.findByTestId("deleted")).toHaveTextContent(/deleted/i);
    expect(w.calls.find((c) => c.path === "delete")?.body).toEqual({ confirm: "delete" });
    expect(localStorage.getItem("mpt_account_session")).toBeNull();
  });
  it("a failed delete keeps the account and says nothing changed", async () => {
    signedIn();
    worker({ me: () => me(), delete: () => ({ status: 503, body: {} }) });
    const user = userEvent.setup();
    app("/account");
    await user.click(await screen.findByRole("button", { name: /delete my account and all scans/i }));
    await user.click(await screen.findByTestId("confirm-delete"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/nothing has been changed/i));
    expect(localStorage.getItem("mpt_account_session")).not.toBeNull();
  });
});

describe("the one-step tick wording", () => {
  it("accounts off: the original box, word for word, original version", () => {
    vi.stubEnv("VITE_ACCOUNTS_ENABLED", "false");
    expect(activeSaveLabel()).toBe(SAVE_CONSENT_LABEL); expect(activeSaveVersion()).toBe(SAVE_CONSENT_VERSION);
  });
  it("accounts on: 'Keep my scan and create my free account', its own version, says IP is kept and there is no password", () => {
    expect(activeSaveLabel()).toBe(ACCOUNT_CONSENT_LABEL); expect(activeSaveVersion()).toBe(ACCOUNT_CONSENT_VERSION);
    expect(ACCOUNT_CONSENT_LABEL).toMatch(/keep my scan and create my free account/i);
    expect(ACCOUNT_CONSENT_LABEL).toMatch(/IP address/); expect(ACCOUNT_CONSENT_LABEL).toMatch(/no password/);
    expect(ACCOUNT_CONSENT_VERSION).not.toBe(SAVE_CONSENT_VERSION);
  });
});
