// MPC-7470 (D12): /scan saves the scan only with an email AND the separate, optional save box (unticked = report still requested, nothing saved); nothing is saved without a scan in the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";
import { SAVE_CONSENT_LABEL, SAVE_CONSENT_VERSION } from "@/lib/saveConsent";
import { rememberCompletedScan, getScanNumber } from "@/lib/webScan";
import type { HexagonData } from "@/lib/deviceDetection";

const NUMBER = "11111111-2222-4333-8444-555555555555";
const hex = (): HexagonData[] =>
  [0, 1].map((i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const MARKETING = /email me my results and occasional privacy tips/i;
const saveBox = () => screen.queryAllByLabelText(SAVE_CONSENT_LABEL)[0];

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getAllByLabelText("Email address")[0], "mpc7470+site@example.com");
  await user.click(screen.getAllByLabelText(MARKETING)[0]);
}
async function submit({ tickSave = true, reply = { success: true, scan_saved: true, scan_number: NUMBER } as unknown, whileFormShown = () => {} } = {}) {
  const f = vi.fn(async (url: unknown) => jsonResponse(String(url).endsWith("/api/scan") ? reply : {}));
  vi.stubGlobal("fetch", f);
  const user = userEvent.setup();
  renderPage(<Scan />);
  whileFormShown();
  await fill(user);
  if (tickSave && saveBox()) await user.click(saveBox());
  await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
  await screen.findByRole("status");
  const call = f.mock.calls.find((c: unknown[]) => String(c[0]).endsWith("/api/scan")) as unknown as [string, RequestInit] | undefined;
  return { f, body: call ? JSON.parse(call[1].body as string) : null };
}

describe("Scan page: save my scan result (D12)", () => {
  it("with the box ticked, posts the scan with save_consent and the wording version, and keeps the scan number", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    const { body } = await submit();
    expect(body).toMatchObject({ email: "mpc7470+site@example.com", consent: true, save_consent: true, save_consent_version: SAVE_CONSENT_VERSION });
    expect(body.scan).toHaveLength(2);
    expect(getScanNumber()).toBe(NUMBER);
  });

  it("shows a separate, optional, unticked box with the exact label, next to the unchanged marketing box", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    renderPage(<Scan />);
    const box = saveBox() as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    expect(box.required).toBe(false);
    expect(screen.getAllByLabelText(MARKETING)[0]).not.toBe(box);
    expect(screen.getAllByTestId("contact-saving-notice").length).toBeGreaterThan(0);
  });

  it("with the box left unticked the report is still requested, but the scan is not sent or saved", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    const { body } = await submit({ tickSave: false, reply: { success: true } });
    expect(body.email).toBe("mpc7470+site@example.com");
    for (const k of ["scan", "save_consent", "save_consent_version", "scan_number"]) expect(k in body).toBe(false);
    expect(getScanNumber()).toBeNull();
  });

  it("with no scan in the browser (arrived directly) there is no save box, the email goes through and nothing is saved", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    const { body } = await submit({ whileFormShown: () => {
      expect(saveBox()).toBeUndefined();
      expect(screen.queryByTestId("contact-saving-notice")).toBeNull();
    } });
    expect(body.email).toBe("mpc7470+site@example.com");
    for (const k of ["scan", "save_consent", "save_consent_version", "scan_number"]) expect(k in body).toBe(false);
    expect(getScanNumber()).toBeNull();
  });

  it("with the switch off the page is as before: no box, no scan sent", async () => {
    rememberCompletedScan(hex()); // off: nothing is kept
    const { body } = await submit({ whileFormShown: () => {
      expect(saveBox()).toBeUndefined();
      expect(screen.queryByTestId("contact-saving-notice")).toBeNull();
    } });
    for (const k of ["scan", "save_consent", "save_consent_version"]) expect(k in body).toBe(false);
  });

  it("still thanks the visitor when the Worker does not save", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hex());
    await submit({ reply: { success: true, scan_saved: false } });
    expect(getScanNumber()).toBeNull();
  });
});
