// MPC-8452: the thank-you screen starts the live view when the Worker returns a stream key, and shows nothing extra when it does not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";

beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const MARKETING = /email me my results and occasional privacy tips/i;
async function submit() {
  const user = userEvent.setup();
  await user.type(screen.getAllByLabelText("Email address")[0], "live+unit@example.com");
  await user.click(screen.getAllByLabelText(MARKETING)[0]);
  await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
}
const stub = (scanBody: unknown) => {
  const f = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/api/scan/live")) return jsonResponse({ items: [{ id: "email-name", label: "Name in your address", status: "found" }], done: false, report_sent: false });
    if (u.endsWith("/api/scan")) return jsonResponse(scanBody);
    return jsonResponse({ inlineMessage: "ok" });
  });
  vi.stubGlobal("fetch", f);
  return f;
};

describe("Scan page live view (MPC-8452)", () => {
  it("a stream key from the Worker shows Alice and starts reading the live results", async () => {
    const f = stub({ success: true, live_token: "abc.123.sig" });
    renderPage(<Scan />);
    await submit();
    expect(await screen.findByTestId("live-scan")).toBeTruthy();
    expect(await screen.findByText("Name in your address", undefined, { timeout: 4000 })).toBeTruthy();
    expect(f.mock.calls.some((c) => String(c[0]).includes("/api/scan/live?t=abc.123.sig"))).toBe(true);
  });

  it("without a key (repeat request, or the feature is off) the thank-you is unchanged and nothing is polled", async () => {
    const f = stub({ success: true, duplicate: true });
    renderPage(<Scan />);
    await submit();
    expect(await screen.findByRole("status")).toHaveTextContent(/we have your email/i);
    expect(screen.queryByTestId("live-scan")).toBeNull();
    expect(f.mock.calls.some((c) => String(c[0]).includes("/api/scan/live"))).toBe(false);
  });
});
