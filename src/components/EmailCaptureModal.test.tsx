// MPC-7471-F3: the post-scan popup asks the SAME report pipeline as /scan (POST /api/scan on the scan-report Worker), with the separate optional save box.
// Every test stubs fetch: nothing here can reach a real Worker or send an email.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse } from "@/test/render";
import EmailCaptureModal from "./EmailCaptureModal";
import { HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";
import { DEFAULT_SCAN_API_URL, rememberCompletedScan } from "@/lib/webScan";
import { REPORT_FAILED_MESSAGE, REPORT_WAIT_MESSAGE } from "@/lib/scanReport";
import { SAVE_CONSENT_LABEL, SAVE_CONSENT_VERSION } from "@/lib/saveConsent";
import type { HexagonData } from "@/lib/deviceDetection";

const SCAN_NUMBER = "0f2b6c1e-8a3d-4e57-9b10-6c2d4f8a1e93";
const EMAIL = "mpc7471f3+unit@example.com";
const REPORT_BOX = /email me my results and occasional privacy tips/i;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); delete (window as unknown as { turnstile?: unknown }).turnstile; });

const hex = (): HexagonData[] =>
  [0, 1, 2].map((i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
const withSavedScanOffered = () => { vi.stubEnv("VITE_SAVE_WEB_SCANS", "true"); rememberCompletedScan(hex()); };

// MPC-7471-F1: the dialog fires confetti on open; jsdom has no canvas, so stub it everywhere in this file.
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const setup = (riskScore = 55) => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  render(<EmailCaptureModal riskScore={riskScore} categoryScores={{ fingerprint: 50 }} confirmedCount={23} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit, user: userEvent.setup() };
};
const email = () => screen.getByPlaceholderText("your@email.com");
const send = () => screen.getByRole("button", { name: /send my report/i });
const reportBox = () => screen.getByLabelText(REPORT_BOX);
const saveBox = () => screen.getByLabelText(SAVE_CONSENT_LABEL);
const bodyOf = (f: ReturnType<typeof vi.fn>, n = 0) => JSON.parse(((f.mock.calls[n] as unknown as [string, RequestInit])[1]).body as string) as Record<string, unknown>;
const urlOf = (f: ReturnType<typeof vi.fn>, n = 0) => String((f.mock.calls[n] as unknown as [string])[0]);

async function fill(user: ReturnType<typeof userEvent.setup>, { save = false } = {}) {
  await user.type(email(), ` ${EMAIL} `);
  await user.click(reportBox());
  if (save) await user.click(saveBox());
}

describe("EmailCaptureModal: shows the score", () => {
  it.each([[85, "High Risk"], [80, "High Risk"], [79, "Medium Risk"], [50, "Medium Risk"], [49, "Low Risk"], [10, "Low Risk"]])("labels risk %i as %s and shows exposure", (score, label) => {
    setup(score);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${Math.round((23 / HEXAGON_COUNT) * 100)}% exposure`))).toBeInTheDocument();
  });
});

describe("EmailCaptureModal: one route, the report pipeline", () => {
  it("validates the email and requires the report consent before calling anything", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await user.type(email(), "a@b");
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("valid email");
    await user.clear(email());
    await user.type(email(), "ok@example.com");
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("tick the box");
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to the scan-report Worker only (not the newsletter Worker) with explicit consent, its source and a per-form request_id", async () => {
    const f = vi.fn(async () => jsonResponse({ success: true, duplicate: false, scan_saved: false }));
    vi.stubGlobal("fetch", f);
    const { user, onSubmit } = setup();
    await fill(user);
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    expect(f).toHaveBeenCalledTimes(1);
    expect(urlOf(f)).toBe(`${DEFAULT_SCAN_API_URL}/api/scan`);
    expect(urlOf(f)).not.toContain("api.myprivacytool.io");
    const b = bodyOf(f);
    expect(b).toMatchObject({ email: EMAIL, consent: true, consent_source: "web_scan_summary" });
    expect(String(b.request_id)).toMatch(UUID4);
    // unticked/not offered: nothing about the scan travels, and the old newsletter/baseline fields are gone
    for (const k of ["scan", "save_consent", "save_consent_version", "riskScore", "categoryScores", "confirmedCount", "source"]) expect(b).not.toHaveProperty(k);
    expect(onSubmit).toHaveBeenCalledWith(EMAIL);
  });

  it("never says 'You're on the list' or promises a newsletter or a baseline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true, baseline: { overall_score: 85, created_at: "2026-10-12T00:00:00Z", is_first: true, delta: 0 } })));
    const { user } = setup();
    await fill(user);
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    expect(document.body).not.toHaveTextContent(/on the list|newsletter|baseline/i);
  });
});

describe("EmailCaptureModal: the separate, optional save box", () => {
  it("is not shown when saving is off or this browser holds no finished scan", () => {
    setup();
    expect(screen.queryByLabelText(SAVE_CONSENT_LABEL)).toBeNull();
    vi.unstubAllEnvs();
  });

  it("is shown separate from the report consent and UNTICKED", () => {
    withSavedScanOffered();
    setup();
    expect(saveBox()).not.toBeChecked();
    expect(reportBox()).not.toBeChecked();
    expect(saveBox()).not.toBe(reportBox());
    expect(saveBox()).not.toBeRequired();
    expect(screen.getByTestId("contact-saving-notice")).toBeInTheDocument();
  });

  it("report consent alone sends no scan and says plainly the scan was not saved", async () => {
    withSavedScanOffered();
    const f = vi.fn(async () => jsonResponse({ success: true, duplicate: false, scan_saved: false }));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await fill(user, { save: false });
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    const b = bodyOf(f);
    expect(b).not.toHaveProperty("scan");
    expect(b).not.toHaveProperty("save_consent");
    expect(screen.getByTestId("scan-not-saved")).toHaveTextContent(/not saved.*no scan number/i);
    expect(screen.queryByTestId("scan-number")).toBeNull();
    expect(sessionStorage.getItem("mpt_pending_scan")).not.toBeNull();   // nothing was sent, so the held scan is untouched
  });

  it("ticking it sends the scan with the approved wording version, and the Worker's scan number is shown with the deletion line", async () => {
    withSavedScanOffered();
    const f = vi.fn(async () => jsonResponse({ success: true, duplicate: false, scan_saved: true, scan_number: SCAN_NUMBER }));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await fill(user, { save: true });
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    const b = bodyOf(f);
    expect(b).toMatchObject({ save_consent: true, save_consent_version: SAVE_CONSENT_VERSION });
    expect(Array.isArray(b.scan) && (b.scan as unknown[]).length).toBe(3);
    expect(screen.getByTestId("scan-number")).toHaveTextContent(SCAN_NUMBER);   // the server-issued number, not one made here
    expect(screen.getByTestId("scan-number-notice")).toHaveTextContent(/quote this number if you want this scan deleted/i);
    expect(sessionStorage.getItem("mpt_pending_scan")).toBeNull();               // saved: the held copy is dropped
  });

  it("ticked but the Worker could not save it: the report is requested, and no scan number is invented", async () => {
    withSavedScanOffered();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true, duplicate: false, scan_saved: false })));
    const { user } = setup();
    await fill(user, { save: true });
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    expect(screen.getByTestId("scan-not-saved")).toHaveTextContent(/could not save your scan.*no scan number/i);
    expect(screen.queryByTestId("scan-number")).toBeNull();
  });

  it("an answer to a repeat request is not presented as a new report, and nothing new is claimed saved", async () => {
    withSavedScanOffered();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true, duplicate: true, scan_saved: false })));
    const { user } = setup();
    await fill(user, { save: true });
    await user.click(send());
    expect(await screen.findByText(/already have a report request/i)).toBeInTheDocument();
    expect(screen.queryByText("Your report is on its way.")).toBeNull();
    expect(screen.queryByTestId("scan-number")).toBeNull();
    expect(screen.getByTestId("scan-not-saved")).not.toHaveTextContent(/could not save/i);
  });
});

describe("EmailCaptureModal: honest failure, bounded retry, one request", () => {
  it.each([
    ["429", () => jsonResponse({ error: "Too many requests" }, 429), REPORT_WAIT_MESSAGE],
    ["500", () => jsonResponse({ error: "x" }, 500), REPORT_FAILED_MESSAGE],
    ["400", () => jsonResponse({ error: "Consent required" }, 400), REPORT_FAILED_MESSAGE],
    ["network error", () => { throw new TypeError("Failed to fetch"); }, REPORT_FAILED_MESSAGE],
  ])("%s: no success screen, actionable message, address and ticks kept, parent not told", async (_n, answer, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    const { user, onSubmit } = setup();
    await fill(user);
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Your report is on its way.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(email()).toHaveValue(EMAIL);   // the address stays in the box for the retry
    expect(reportBox()).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("logs only the kind and status of a failure, never the address", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "x" }, 500)));
    const { user } = setup();
    await fill(user);
    await user.click(send());
    await screen.findByRole("alert");
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain("mpc7471f3");
  });

  it("a retry after a lost answer is the SAME request (same request_id), and the scan number then comes back", async () => {
    withSavedScanOffered();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? (() => { throw new TypeError("timeout after the Worker had saved"); })() : jsonResponse({ success: true, duplicate: true, replay: true, scan_saved: true, scan_number: SCAN_NUMBER })));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await fill(user, { save: true });
    await user.click(send());
    await screen.findByRole("alert");
    await user.click(send());
    await screen.findByText(/already have a report request/i);
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).request_id).toBe(bodyOf(f, 0).request_id);
    expect(screen.getByTestId("scan-number")).toHaveTextContent(SCAN_NUMBER);
  });

  it("two submits in the same instant send one request", async () => {
    let release: (r: Response) => void = () => {};
    const f = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await fill(user);
    const form = send().closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    release(jsonResponse({ success: true }));
    await screen.findByText("Your report is on its way.");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("stops after three failed tries and points to email, so a broken connection is not a retry storm", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async () => jsonResponse({ error: "x" }, 500));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await fill(user);
    for (let i = 0; i < 3; i++) { await user.click(send()); await waitFor(() => expect(f).toHaveBeenCalledTimes(i + 1)); await screen.findByRole("alert"); }
    expect(send()).toBeDisabled();
    expect(screen.getByRole("link", { name: /hello@myprivacytool\.io/ })).toHaveAttribute("href", "mailto:hello@myprivacytool.io");
    fireEvent.submit(send().closest("form") as HTMLFormElement);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

// MPC-8430: the report Worker checks its OWN Turnstile widget, so the popup must use that site key (the newsletter one would be rejected).
describe("Turnstile", () => {
  const stubTurnstile = (autoToken: string | null) => {
    const render = vi.fn((_el: HTMLElement, o: { callback: (t: string) => void }) => { if (autoToken) o.callback(autoToken); return "w1"; });
    const reset = vi.fn(), remove = vi.fn();
    (window as unknown as { turnstile: unknown }).turnstile = { render, reset, remove };
    return { render, reset, remove };
  };

  it("renders the report widget (scan site key) and sends its token", async () => {
    const t = stubTurnstile("tok-123");
    const f = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await vi.waitFor(() => expect(t.render).toHaveBeenCalled());
    expect(t.render.mock.calls[0][1]).toMatchObject({ sitekey: "0x4AAAAAAFiCB-c5gCsrkmEZ", appearance: "interaction-only" });
    await fill(user);
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    expect(bodyOf(f)["cf-turnstile-response"]).toBe("tok-123");
  });

  it("does not call the Worker until the widget has produced a token", async () => {
    const t = stubTurnstile(null);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await vi.waitFor(() => expect(t.render).toHaveBeenCalled());
    await fill(user);
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("Verifying you are human");
    expect(f).not.toHaveBeenCalled();
  });

  it("resets the widget after a refusal so the retry gets a fresh token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stubTurnstile("tok-1");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Verification failed" }, 403)));
    const { user } = setup();
    await vi.waitFor(() => expect(t.render).toHaveBeenCalled());
    await fill(user);
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent(REPORT_FAILED_MESSAGE);
    expect(t.reset).toHaveBeenCalledWith("w1");
  });

  it("still submits without a token when the Turnstile script is blocked", async () => {
    const f = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await fill(user);
    await user.click(send());
    await screen.findByText("Your report is on its way.");
    expect(bodyOf(f)).not.toHaveProperty("cf-turnstile-response");
  });
});

describe("EmailCaptureModal: closing", () => {
  it("closes from the X, the backdrop and 'No thanks'", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /no thanks/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
