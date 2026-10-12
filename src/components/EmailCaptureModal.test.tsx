// MPC-7300: post-scan email capture -> mpt-leads Worker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse } from "@/test/render";
import EmailCaptureModal from "./EmailCaptureModal";
import { HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";
import { SAVE_CONSENT_LABEL, SAVE_CONSENT_VERSION } from "@/lib/saveConsent";
import { rememberCompletedScan, getScanNumber } from "@/lib/webScan";
import type { HexagonData } from "@/lib/deviceDetection";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); localStorage.clear(); });
const setup = (riskScore = 55) => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  render(<EmailCaptureModal riskScore={riskScore} categoryScores={{ fingerprint: 50 }} confirmedCount={23} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit, user: userEvent.setup() };
};
const email = () => screen.getByPlaceholderText("your@email.com");
const send = () => screen.getByRole("button", { name: /send my privacy check/i });

describe("EmailCaptureModal", () => {
  it.each([[75, "High Risk"], [50, "Medium Risk"], [10, "Low Risk"]])("labels risk %i as %s and shows exposure", (score, label) => {
    setup(score);
    expect(screen.getByText(label)).toBeInTheDocument();
    // MPC-7466: the exposure percentage divides by the registry hexagon count (was a hard-coded 46).
    expect(screen.getByText(new RegExp(`${Math.round((23 / HEXAGON_COUNT) * 100)}% exposure`))).toBeInTheDocument();
  });

  it("validates the email and requires consent before calling the Worker", async () => {
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

  it("posts scores + explicit consent and shows the first-scan baseline", async () => {
    const f = vi.fn(async () => jsonResponse({ success: true, baseline: { overall_score: 55, created_at: "2026-10-06T00:00:00Z", is_first: true, delta: 0 } }));
    vi.stubGlobal("fetch", f);
    const { user, onSubmit } = setup();
    await user.type(email(), " ok@example.com ");
    await user.click(screen.getByRole("checkbox"));
    await user.click(send());
    await screen.findByText("You're on the list.");
    expect(screen.getByText(/Baseline saved: 55\/100/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith("ok@example.com");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("mpt-leads");
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "ok@example.com", riskScore: 55, confirmedCount: 23, consent: true, consent_source: "web_scan_summary", categoryScores: { fingerprint: 50 },
    });
  });

  it.each([[-10, "lower (better)"], [10, "higher (worse)"], [0, "no change"]])("describes a re-scan delta of %i", async (delta, text) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ baseline: { overall_score: 50, created_at: "2026-10-01T00:00:00Z", is_first: false, delta } })));
    const { user } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(send());
    expect(await screen.findByText(new RegExp(`Your baseline: 50/100.*${text.replace(/[()]/g, "\\$&")}`))).toBeInTheDocument();
  });

  it("shows an error when the Worker fails, and tolerates a non-JSON success body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const a = setup();
    await a.user.type(email(), "ok@example.com");
    await a.user.click(screen.getByRole("checkbox"));
    await a.user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("closes from the X, the backdrop and 'No thanks'", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /no thanks/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

// MPC-7470 (D12): the separate "save my scan result" box at the contact step.
describe("EmailCaptureModal: save my scan result", () => {
  const NUMBER = "11111111-2222-4333-8444-555555555555";
  const hexes = (): HexagonData[] =>
    [0, 1].map((i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `v${i}`, icon: "x", confidence: 80, risk: "low", confirmed: true, category: "device" }));
  const saveBox = () => screen.queryByLabelText(SAVE_CONSENT_LABEL) as HTMLInputElement | null;
  const marketing = () => screen.getByLabelText(/email me my fix guide and privacy check/i);
  const routed = () => vi.fn(async (url: unknown) =>
    String(url).includes("/api/scan") ? jsonResponse({ success: true, scan_saved: true, scan_number: NUMBER }) : jsonResponse({ success: true }));

  it("shows the exact label as a separate, unticked box; the marketing box is unchanged", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hexes());
    setup();
    expect(saveBox()).not.toBeNull();
    expect(saveBox()!.checked).toBe(false);
    expect(marketing()).not.toBe(saveBox());
    expect(screen.getByText("Email me my fix guide and Privacy Check, the monthly newsletter. I can unsubscribe at any time.")).toBeInTheDocument();
  });

  it("requires the save box: without it nothing is sent anywhere", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hexes());
    const f = routed(); vi.stubGlobal("fetch", f);
    const { user } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(marketing());
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("save your scan result");
    expect(f).not.toHaveBeenCalled();
  });

  it("with the box ticked, posts the scan with save_consent to the scan-report Worker and keeps the scan number", async () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hexes());
    const f = routed(); vi.stubGlobal("fetch", f);
    const { user, onSubmit } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(marketing());
    await user.click(saveBox()!);
    await user.click(send());
    await screen.findByText("You're on the list.");
    expect(onSubmit).toHaveBeenCalledWith("ok@example.com");
    const call = f.mock.calls.find((c) => String(c[0]).includes("/api/scan")) as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body).toMatchObject({ email: "ok@example.com", consent: true, save_consent: true, save_consent_version: SAVE_CONSENT_VERSION });
    expect(body.scan).toHaveLength(2);
    expect(getScanNumber()).toBe(NUMBER);
  });

  it("a failed save request does not undo the lead the visitor sees as recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    rememberCompletedScan(hexes());
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => (String(url).includes("/api/scan") ? jsonResponse({}, 500) : jsonResponse({ success: true }))));
    const { user } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(marketing());
    await user.click(saveBox()!);
    await user.click(send());
    await screen.findByText("You're on the list.");
    expect(getScanNumber()).toBeNull();
  });

  it("with no scan in the browser, or saving off, there is no save box and no scan request", async () => {
    const f = routed(); vi.stubGlobal("fetch", f);
    // saving off
    rememberCompletedScan(hexes());
    const a = setup();
    expect(saveBox()).toBeNull();
    await a.user.type(email(), "ok@example.com");
    await a.user.click(marketing());
    await a.user.click(send());
    await screen.findByText("You're on the list.");
    expect(f.mock.calls.every((c) => !String(c[0]).includes("/api/scan"))).toBe(true);
  });

  it("with saving on but no scan in this browser, there is no save box", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    setup();
    expect(saveBox()).toBeNull();
  });
});

