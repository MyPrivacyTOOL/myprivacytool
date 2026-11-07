import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PasswordCheck from "./PasswordCheck";
import * as lib from "@/lib/pwnedPassword";
import { CONSENT_KEY } from "@/lib/cookieConsent";

const gtag = vi.fn();
beforeEach(() => { gtag.mockClear(); window.gtag = gtag; window.localStorage.clear(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete window.gtag; window.localStorage.clear(); });

const grant = () => window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: true, at: new Date().toISOString() }));
const view = () => render(<MemoryRouter><PasswordCheck /></MemoryRouter>);
const events = () => gtag.mock.calls.filter((c) => c[0] === "event").map((c) => c[1]);
const type = (pw: string) => {
  fireEvent.change(screen.getByLabelText("Password to check"), { target: { value: pw } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
};

describe("PasswordCheck", () => {
  it("renders nothing and sends nothing when the flag is off (default)", () => {
    grant();
    const { container } = view();
    expect(container).toBeEmptyDOMElement();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("shows the approved disclosure: 5 characters of the code, and that Have I Been Pwned sees the IP address", () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    view();
    const text = screen.getByTestId("password-check").textContent ?? "";
    expect(text).toContain("send only the first 5 characters of that code to Have I Been Pwned");
    expect(text).toContain("Have I Been Pwned can see your IP address");
    expect(text).toContain("We do not see, store or log your password.");
  });

  it("shows the count and the fix checklist for an exposed password, and clears the field", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    const spy = vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "checked", count: 1234 });
    view();
    type("hunter2-test");
    await waitFor(() => expect(screen.getByText(/appeared 1,234 times/)).toBeInTheDocument());
    expect(screen.getByText(/two-factor/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("hunter2-test");
    expect((screen.getByLabelText("Password to check") as HTMLInputElement).value).toBe("");
  });

  it("says a check error is not a safe result", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "error", reason: "unreachable" });
    view();
    type("anything");
    await waitFor(() => expect(screen.getByText(/not a safe result/)).toBeInTheDocument());
  });
});

describe("PasswordCheck: link to the free scan (MPC-9786)", () => {
  it.each([
    ["found", { status: "checked", count: 5 }],
    ["not found", { status: "checked", count: 0 }],
  ] as const)("shows the approved line and the /scan link for a %s result", async (_n, r) => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue(r);
    view();
    expect(screen.queryByTestId("password-check-scan-link")).toBeNull();
    type("whatever-pw");
    const line = await screen.findByTestId("password-check-scan-link");
    expect(line.textContent).toBe("Your email can be exposed too. Run the free scan to check.");
    expect(screen.getByRole("link", { name: "Run the free scan to check." })).toHaveAttribute("href", "/scan?utm_source=password_check");
  });

  it("shows no link on an error result", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "error", reason: "unreachable" });
    view();
    type("whatever-pw");
    await screen.findByText(/not a safe result/);
    expect(screen.queryByTestId("password-check-scan-link")).toBeNull();
  });
});

describe("PasswordCheck: usage counts (MPC-9785)", () => {
  it("with consent: sends exactly used, then scan_click; no params; nothing derived from the password or the result", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    grant();
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "checked", count: 98765 });
    view();
    type("Secret-Pw-123!");
    fireEvent.click(await screen.findByRole("link", { name: "Run the free scan to check." }));
    expect(events()).toEqual(["password_check_used", "password_check_scan_click"]);
    for (const c of gtag.mock.calls) expect(c[2]).toBeUndefined();   // no parameters at all
    const sent = JSON.stringify(gtag.mock.calls);
    for (const bad of ["Secret-Pw-123!", "98765", "found", "count", "hash"]) expect(sent).not.toContain(bad);
  });

  it("with consent: an error sends used then error", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    grant();
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "error", reason: "unreachable" });
    view();
    type("x-pw");
    await screen.findByText(/not a safe result/);
    expect(events()).toEqual(["password_check_used", "password_check_error"]);
  });

  it.each([
    ["no choice made", () => {}],
    ["analytics declined", () => window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: false, at: new Date().toISOString() }))],
  ])("without consent (%s): sends 0 events across the whole flow, including the click", async (_n, setup) => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    setup();
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "checked", count: 3 });
    view();
    type("pw-no-consent");
    fireEvent.click(await screen.findByRole("link", { name: "Run the free scan to check." }));
    expect(gtag).not.toHaveBeenCalled();
  });
});
