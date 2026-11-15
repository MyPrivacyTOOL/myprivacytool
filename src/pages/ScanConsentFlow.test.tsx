// MPC-9888: the consent block above the scan form. Nothing third-party loads before the click; the click records the consent, then loads Turnstile.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import { __resetScanConsentForTests, hasScanConsent } from "@/lib/scanConsent";
import { CONSENT_CONFIG } from "../../shared/recipients/consent-config";

vi.mock("@/lib/hubspot", () => ({ submitHubSpotForm: vi.fn().mockResolvedValue(undefined), consentFields: () => ({}) }));
const requestScanReport = vi.fn().mockResolvedValue({});
vi.mock("@/lib/scanReport", async (orig) => ({ ...(await orig<typeof import("@/lib/scanReport")>()), requestScanReport: (...a: unknown[]) => requestScanReport(...a) }));
const loadTs = vi.fn();
const render_ = vi.fn();
let onToken: (t: string) => void = () => {};
vi.mock("@/lib/turnstile", async (orig) => ({ ...(await orig<typeof import("@/lib/turnstile")>()), loadTurnstile: () => { loadTs(); return Promise.resolve({ render: (_e: HTMLElement, o: { callback: (t: string) => void }) => { render_(); onToken = o.callback; return "w"; }, reset: vi.fn(), remove: vi.fn() }); } }));
import Scan from "./Scan";

const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("Scan form consent", () => {
  beforeEach(() => { __resetScanConsentForTests(); loadTs.mockClear(); render_.mockClear(); requestScanReport.mockClear(); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ consent_id: ID, consent_version: CONSENT_CONFIG.consent_version, consented_at: "2026-11-08T00:00:00Z" }), { status: 201 })); });

  it("shows the wording above the button, loads nothing from Cloudflare before the click, then records consent and loads Turnstile", async () => {
    renderPage(<Scan />);
    expect(screen.getAllByTestId("scan-consent-text")[0].textContent).toMatch(/Pressing Scan me means you agree/);
    expect(screen.getAllByTestId("scan-consent-text")[0].textContent).toMatch(/7 days/);
    expect(loadTs).not.toHaveBeenCalled();
    expect(render_).not.toHaveBeenCalled();
    expect(hasScanConsent()).toBe(false);
    const user = userEvent.setup();
    await user.type(screen.getAllByLabelText("Email address")[0], "a@example.com");
    await user.click(screen.getAllByLabelText(/email me my results and occasional privacy tips/i)[0]);
    await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
    await waitFor(() => expect(hasScanConsent()).toBe(true));
    await waitFor(() => expect(loadTs).toHaveBeenCalled());
    await waitFor(() => expect(render_).toHaveBeenCalled());
    expect(requestScanReport).not.toHaveBeenCalled();   // waits for the token
    act(() => onToken("tok"));
    await waitFor(() => expect(requestScanReport).toHaveBeenCalledTimes(1));
  });
});
