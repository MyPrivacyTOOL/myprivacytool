// MPC-7535: the /scan page must never promise a report that was not requested. A refused or unanswered report request shows an honest message,
// keeps the email in the box, and a retry does not send the HubSpot lead a second time.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";
import { REPORT_FAILED_MESSAGE, REPORT_WAIT_MESSAGE } from "@/lib/scanReport";

beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const MARKETING = /email me my results and occasional privacy tips/i;
const EMAIL = "mpc7535+unit@example.com";

type Worker = () => Response | Promise<Response>;
function setup(worker: Worker) {
  const f = vi.fn(async (url: unknown) => (String(url).endsWith("/api/scan") ? worker() : jsonResponse({ inlineMessage: "ok" })));
  vi.stubGlobal("fetch", f);
  return f;
}
const hubspotCalls = (f: ReturnType<typeof setup>) => f.mock.calls.filter((c) => String(c[0]).includes("hsforms")).length;
const workerCalls = (f: ReturnType<typeof setup>) => f.mock.calls.filter((c) => String(c[0]).endsWith("/api/scan")).length;

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getAllByLabelText("Email address")[0], EMAIL);
  await user.click(screen.getAllByLabelText(MARKETING)[0]);
  await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
}

describe("Scan page: a failed report request is not hidden (MPC-7535)", () => {
  it.each([
    ["429 (rate limited)", () => jsonResponse({ error: "Too many requests" }, 429), REPORT_WAIT_MESSAGE],
    ["500 (server error)", () => jsonResponse({ error: "Could not record your scan request" }, 500), REPORT_FAILED_MESSAGE],
    ["400 (request refused)", () => jsonResponse({ error: "Consent required" }, 400), REPORT_FAILED_MESSAGE],
    ["403 (origin refused)", () => jsonResponse({ error: "Forbidden origin" }, 403), REPORT_FAILED_MESSAGE],
    ["network error", () => { throw new TypeError("Failed to fetch"); }, REPORT_FAILED_MESSAGE],
  ])("%s: no thank-you screen, honest message, email kept, lead sent once", async (_name, worker, message) => {
    const f = setup(worker as Worker);
    const user = userEvent.setup();
    renderPage(<Scan />);
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("status")).toBeNull();                       // the thank-you block is role=status
    expect(screen.queryByText(/we have your email/i)).toBeNull();
    expect((screen.getAllByLabelText("Email address")[0] as HTMLInputElement).value).toBe(EMAIL);
    expect(hubspotCalls(f)).toBe(1);                                         // the lead is still sent
  });

  it("a retry after a failure requests the report again, does not resend the lead, then thanks the visitor", async () => {
    let attempt = 0;
    const f = setup(() => (++attempt === 1 ? jsonResponse({ error: "x" }, 500) : jsonResponse({ success: true })));
    const user = userEvent.setup();
    renderPage(<Scan />);
    await fillAndSubmit(user);
    await screen.findByRole("alert");
    await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
    expect(await screen.findByRole("status")).toHaveTextContent(/we have your email/i);
    expect(workerCalls(f)).toBe(2);
    expect(hubspotCalls(f)).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an accepted request still shows the thank-you screen", async () => {
    const f = setup(() => jsonResponse({ success: true }));
    renderPage(<Scan />);
    await fillAndSubmit(userEvent.setup());
    expect(await screen.findByRole("status")).toHaveTextContent(/we have your email/i);
    expect(workerCalls(f)).toBe(1);
  });

  it("a blank VITE_SCAN_API_URL still reaches the Worker (it used to switch the request off silently)", async () => {
    vi.stubEnv("VITE_SCAN_API_URL", "");
    const f = setup(() => jsonResponse({ success: true }));
    renderPage(<Scan />);
    await fillAndSubmit(userEvent.setup());
    await screen.findByRole("status");
    expect(f.mock.calls.find((c) => String(c[0]).endsWith("/api/scan"))?.[0]).toBe("https://mpt-scan-report.myprivacytool.workers.dev/api/scan");
  });
});
