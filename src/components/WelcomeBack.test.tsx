// MPC-7494: the open mirror. Match shown; every "no" shows nothing; no call without consent / held number / switches; keep makes no call; delete calls the route.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import WelcomeBack from "./WelcomeBack";
import type { HexagonData } from "@/lib/deviceDetection";

const HELD = "11111111-2222-4333-8444-555555555555";
const MATCHED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const hexagons = [{ id: "canvas-hash", label: "Canvas", value: "abc", icon: "x", confidence: 90, risk: "low", confirmed: true }] as unknown as HexagonData[];
const match = {
  recognised: true, scan_number: MATCHED, last_seen: "2026-09-30",
  signals: [{ id: "canvas-hash", label: "Canvas fingerprint" }, { id: "timezone", label: "Timezone and locale" }],
  signals_compared: 6, match: { agreement: 0.9, threshold: 0.85 }, caveat: "This may be another device just like yours.",
};
const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackEvent: (...a: unknown[]) => track(...a) }));

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const flags = (save: string | undefined, rec: string | undefined) => {
  vi.stubEnv("VITE_SAVE_WEB_SCANS", save as string);
  vi.stubEnv("VITE_RECOGNITION_ENABLED", rec as string);
};

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); track.mockClear();
  localStorage.setItem("mpt_web_scan_number", HELD);
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  flags("true", "true");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("WelcomeBack", () => {
  it("shows the match: headline, signals, last seen, caveat, every-site line, and sends the held number with the scan", async () => {
    fetchMock.mockImplementation(() => reply(match));
    render(<WelcomeBack hexagons={hexagons} />);
    expect(await screen.findByText(/Welcome back\. We recognised your device without a cookie/)).toBeTruthy();
    expect(screen.getByTestId("welcome-back-last-seen").textContent).toBe("2026-09-30");
    expect(screen.getByText("Canvas fingerprint")).toBeTruthy();
    expect(screen.getByText("Timezone and locale")).toBeTruthy();
    expect(screen.getByTestId("welcome-back-caveat").textContent).toBe(match.caveat);
    expect(screen.getByText(/Every website you visit can do the same/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/recognise$/);
    const body = JSON.parse(init.body);
    expect(body.held_scan_number).toBe(HELD);
    expect(body.hexagons[0].id).toBe("canvas-hash");
    expect(Object.keys(body).sort()).toEqual(["held_scan_number", "hexagons"]);
  });

  it("shows nothing when the API says not recognised (no match, or below the threshold)", async () => {
    fetchMock.mockImplementation(() => reply({ recognised: false }));
    const { container } = render(<WelcomeBack hexagons={hexagons} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when the call fails or answers an error", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    const { container, unmount } = render(<WelcomeBack hexagons={hexagons} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
    unmount();
    fetchMock.mockImplementation(() => reply({ error: "x" }, false));
    const second = render(<WelcomeBack hexagons={hexagons} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(second.container.innerHTML).toBe("");
  });

  it.each([
    ["recognition flag off", "true", undefined],
    ["save flag off", undefined, "true"],
    ["both off", undefined, undefined],
    ["flag not exactly true", "true", "1"],
  ])("makes no API call when the switch is off (%s)", async (_n, save, rec) => {
    flags(save, rec);
    const { container } = render(<WelcomeBack hexagons={hexagons} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("makes no API call when this browser holds no scan number (no consent given)", async () => {
    localStorage.clear();
    render(<WelcomeBack hexagons={hexagons} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no API call when the only scan number is from this visit (not an earlier one)", async () => {
    sessionStorage.setItem("mpt_web_scan_number", HELD);
    render(<WelcomeBack hexagons={hexagons} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Keep my record makes no call, says it stays under the 12 months, and sends only a count-only event", async () => {
    fetchMock.mockImplementation(() => reply(match));
    render(<WelcomeBack hexagons={hexagons} />);
    fireEvent.click(await screen.findByTestId("welcome-back-keep"));
    expect(screen.getByTestId("welcome-back-kept").textContent).toMatch(/normal 12 months/);
    expect(fetchMock).toHaveBeenCalledTimes(1);   // only the recognise call
    expect(localStorage.getItem("mpt_web_scan_number")).toBe(HELD);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(new RegExp(`${MATCHED}|${HELD}|Canvas|abc`));
  });

  it("Delete my record calls the delete route with the matched scan number and confirms it is gone", async () => {
    localStorage.setItem("mpt_web_scan_number", MATCHED);   // the held number is the one deleted
    fetchMock.mockImplementation((url: string) => reply(String(url).endsWith("/delete") ? { deleted: true } : match));
    render(<WelcomeBack hexagons={hexagons} />);
    fireEvent.click(await screen.findByTestId("welcome-back-delete"));
    expect(await screen.findByTestId("welcome-back-deleted")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toMatch(/\/api\/recognise\/delete$/);
    expect(JSON.parse(init.body)).toEqual({ scan_number: MATCHED });
    expect(localStorage.getItem("mpt_web_scan_number")).toBeNull();   // same number: cleared
    expect(JSON.stringify(track.mock.calls)).not.toMatch(new RegExp(MATCHED));
  });

  it("deleting a different record than the one held keeps the held scan number", async () => {
    fetchMock.mockImplementation((url: string) => reply(String(url).endsWith("/delete") ? { deleted: true } : match));
    render(<WelcomeBack hexagons={hexagons} />);
    fireEvent.click(await screen.findByTestId("welcome-back-delete"));
    await screen.findByTestId("welcome-back-deleted");
    expect(localStorage.getItem("mpt_web_scan_number")).toBe(HELD);
  });

  it("does not claim deletion when the route fails; the visitor can try again", async () => {
    fetchMock.mockImplementation((url: string) => String(url).endsWith("/delete") ? reply({ error: "x" }, false) : reply(match));
    render(<WelcomeBack hexagons={hexagons} />);
    fireEvent.click(await screen.findByTestId("welcome-back-delete"));
    expect(await screen.findByTestId("welcome-back-error")).toBeTruthy();
    expect(screen.queryByTestId("welcome-back-deleted")).toBeNull();
    expect(screen.getByTestId("welcome-back-delete")).toBeTruthy();
  });
});
