// MPC-8430: the /scan form sends a Turnstile token with the report request and waits for one while a widget is on the page.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";

vi.mock("@/lib/hubspot", () => ({ submitHubSpotForm: vi.fn().mockResolvedValue(undefined), consentFields: () => ({}) }));
const requestScanReport = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/scanReport", async (orig) => ({ ...(await orig<typeof import("@/lib/scanReport")>()), requestScanReport: (...a: unknown[]) => requestScanReport(...a) }));

let onToken: (t: string) => void = () => {};
const render_ = vi.fn();
vi.mock("@/lib/turnstile", async (orig) => ({
  ...(await orig<typeof import("@/lib/turnstile")>()),
  loadTurnstile: () => Promise.resolve({ render: (_el: HTMLElement, o: { callback: (t: string) => void }) => { render_(o); onToken = o.callback; return "w1"; }, reset: vi.fn(), remove: vi.fn() }),
}));

import Scan from "./Scan";

const MARKETING = /email me my results and occasional privacy tips/i;
const mount = () => renderPage(<Scan />);
const submit = async () => {
  const user = userEvent.setup();
  await user.type(screen.getAllByLabelText("Email address")[0], "a@example.com");
  await user.click(screen.getAllByLabelText(MARKETING)[0]);
  await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
};

describe("Scan page Turnstile", () => {
  beforeEach(() => { requestScanReport.mockClear(); render_.mockClear(); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); localStorage.clear(); });

  it("does not request the report before a token exists", async () => {
    mount();
    await waitFor(() => expect(render_).toHaveBeenCalled());
    await submit();
    expect(await screen.findByText(/Verifying you are human/)).toBeTruthy();
    expect(requestScanReport).not.toHaveBeenCalled();
  });

  it("sends the token with the report request", async () => {
    mount();
    await waitFor(() => expect(render_).toHaveBeenCalled());
    act(() => onToken("tok-123"));
    await submit();
    await waitFor(() => expect(requestScanReport).toHaveBeenCalled());
    expect(requestScanReport.mock.calls[0][3]).toBe("tok-123");
  });
});
