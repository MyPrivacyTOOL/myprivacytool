// MPC-9888: the home page. A cold visitor sees the consent block and Scan me; pressing it records the consent and the block goes away;
// a visitor who already consented (another door) is not asked again.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import { __resetScanConsentForTests, __seedScanConsentForTests, hasScanConsent } from "@/lib/scanConsent";
import { CONSENT_CONFIG } from "../../shared/recipients/consent-config";
import Index from "./Index";

const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const loadTs = vi.fn();
vi.mock("@/lib/turnstile", async (orig) => ({ ...(await orig<typeof import("@/lib/turnstile")>()), loadTurnstile: () => { loadTs(); return Promise.resolve(undefined); } }));

describe("home page consent block", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    loadTs.mockClear(); localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ consent_id: ID, consent_version: CONSENT_CONFIG.consent_version, consented_at: "2026-11-08T00:00:00Z" }), { status: 201 }));
  });

  it("cold arrival: wording and Scan me; Turnstile is not loaded until the click, then consent is recorded and analytics is chosen", async () => {
    __resetScanConsentForTests();
    renderPage(<Index />);
    expect(screen.getByTestId("scan-consent-text").textContent).toMatch(/Pressing Scan me means you agree/);
    expect(loadTs).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByTestId("scan-me"));
    await waitFor(() => expect(hasScanConsent()).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("scan-me")).toBeNull());
    expect(loadTs).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("mpt_cookie_consent") ?? "{}").analytics).toBe(true);   // Scan me counts as the analytics choice
  });

  it("a journey that already consented is not asked again", () => {
    __seedScanConsentForTests();
    renderPage(<Index />);
    expect(screen.queryByTestId("scan-me")).toBeNull();
    expect(screen.queryByTestId("scan-consent-text")).toBeNull();
  });
});
