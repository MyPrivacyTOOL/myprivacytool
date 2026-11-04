// MPC-7494: the SEPARATE, optional "recognise this device" box at the contact step. Own consent, never implied by the save box, never needed for the report or the saving.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";
import { RECOGNISE_CONSENT_LABEL, RECOGNISE_CONSENT_VERSION, SAVE_CONSENT_LABEL, SAVE_CONSENT_VERSION } from "@/lib/saveConsent";
import { rememberCompletedScan } from "@/lib/webScan";
import type { HexagonData } from "@/lib/deviceDetection";

const NUMBER = "11111111-2222-4333-8444-555555555555";
const hex = (): HexagonData[] =>
  [0, 1].map((i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const MARKETING = /email me my results and occasional privacy tips/i;
const saveBox = () => screen.queryAllByLabelText(SAVE_CONSENT_LABEL)[0] as HTMLInputElement | undefined;
const recogniseBox = () => screen.queryAllByLabelText(RECOGNISE_CONSENT_LABEL)[0] as HTMLInputElement | undefined;
const flags = (save: boolean, rec: boolean) => {
  if (save) vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
  if (rec) vi.stubEnv("VITE_RECOGNITION_ENABLED", "true");
  rememberCompletedScan(hex());
};

async function submit({ tickSave = false, tickRecognise = false } = {}) {
  const f = vi.fn(async (url: unknown) => jsonResponse(String(url).endsWith("/api/scan") ? { success: true, scan_saved: tickSave, ...(tickSave ? { scan_number: NUMBER } : {}) } : {}));
  vi.stubGlobal("fetch", f);
  const user = userEvent.setup();
  renderPage(<Scan />);
  await user.type(screen.getAllByLabelText("Email address")[0], "mpc7494+site@example.com");
  await user.click(screen.getAllByLabelText(MARKETING)[0]);
  if (tickSave) await user.click(saveBox()!);
  if (tickRecognise) await user.click(recogniseBox()!);
  await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
  await screen.findByRole("status");
  const call = f.mock.calls.find((c: unknown[]) => String(c[0]).endsWith("/api/scan")) as unknown as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

describe("Scan page: the recognise opt-in box (MPC-7494)", () => {
  it("is not shown when recognition is off (save flag on only)", () => {
    flags(true, false);
    renderPage(<Scan />);
    expect(saveBox()).toBeTruthy();
    expect(recogniseBox()).toBeUndefined();
  });

  it("is not shown when saving is off (recognition flag on only)", () => {
    flags(false, true);
    renderPage(<Scan />);
    expect(saveBox()).toBeUndefined();
    expect(recogniseBox()).toBeUndefined();
  });

  it("is not shown when this browser holds no finished scan", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    vi.stubEnv("VITE_RECOGNITION_ENABLED", "true");
    renderPage(<Scan />);
    expect(recogniseBox()).toBeUndefined();
  });

  it("when both switches are on: a separate, optional, UNTICKED box with the exact wording, disabled until the save box is ticked", async () => {
    flags(true, true);
    renderPage(<Scan />);
    const rec = recogniseBox()!;
    expect(rec).toBeTruthy();
    expect(rec.checked).toBe(false);
    expect(rec.required).toBe(false);
    expect(rec.disabled).toBe(true);
    expect(rec).not.toBe(saveBox());
    expect(rec.closest("label")?.textContent).toBe(RECOGNISE_CONSENT_LABEL);
    expect(saveBox()!.disabled).toBe(false);
    await userEvent.setup().click(saveBox()!);
    expect(recogniseBox()!.disabled).toBe(false);
    expect(recogniseBox()!.checked).toBe(false);   // ticking the save box never ticks this one
  });

  it("un-ticking the save box withdraws the recognise tick and disables the box again", async () => {
    flags(true, true);
    renderPage(<Scan />);
    const user = userEvent.setup();
    await user.click(saveBox()!);
    await user.click(recogniseBox()!);
    expect(recogniseBox()!.checked).toBe(true);
    await user.click(saveBox()!);
    expect(recogniseBox()!.checked).toBe(false);
    expect(recogniseBox()!.disabled).toBe(true);
  });

  it("is not sent when unticked: the scan is saved with the save consent only", async () => {
    flags(true, true);
    const body = await submit({ tickSave: true });
    expect(body).toMatchObject({ save_consent: true, save_consent_version: SAVE_CONSENT_VERSION });
    expect("recognise_consent" in body).toBe(false);
    expect("recognise_consent_version" in body).toBe(false);
  });

  it("is sent with its wording version when ticked, in the same request as the save consent", async () => {
    flags(true, true);
    const body = await submit({ tickSave: true, tickRecognise: true });
    expect(body).toMatchObject({ save_consent: true, save_consent_version: SAVE_CONSENT_VERSION, recognise_consent: true, recognise_consent_version: RECOGNISE_CONSENT_VERSION });
    expect(body.scan).toHaveLength(2);
  });

  it("the report and the saving still work with the new box left unticked and the save box unticked: nothing saved, nothing about recognition sent", async () => {
    flags(true, true);
    const body = await submit();
    expect(body.email).toBe("mpc7494+site@example.com");
    for (const k of ["scan", "save_consent", "save_consent_version", "recognise_consent", "recognise_consent_version"]) expect(k in body).toBe(false);
  });
});
