// MPC-7446: HK-only Stop Spam card (homepage / report) with the "for Hong Kong numbers" note and override.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";

const flags = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/config/hkSpamPage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/hkSpamPage")>()),
  isHkSpamSurfaceEnabled: () => flags.enabled,
}));

import HkStopSpamCard from "./HkStopSpamCard";
import { HK_OVERRIDE_KEY, resetHkGeoCache } from "@/lib/hkVisitor";

const stubGeo = (country: string | null) => {
  const f = vi.fn(async () => ({ ok: true, json: async () => ({ country }) }) as unknown as Response);
  vi.stubGlobal("fetch", f);
  return f;
};

beforeEach(() => {
  flags.enabled = true;
  localStorage.clear();
  resetHkGeoCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("HkStopSpamCard", () => {
  it("renders nothing and makes no request while the launch flag is off", async () => {
    flags.enabled = false;
    const f = stubGeo("HK");
    renderPage(<HkStopSpamCard placement="home" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("hk-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hk-card-note")).not.toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("shows the card to Hong Kong visitors, linking to /HongKongSpam with the placement as UTM", async () => {
    stubGeo("HK");
    renderPage(<HkStopSpamCard placement="home" />);
    const card = await screen.findByTestId("hk-card");
    expect(card).toHaveTextContent(/stop spam calls and sms in hong kong/i);
    const link = screen.getByRole("link", { name: "Stop spam to this phone" });
    expect(link.getAttribute("href")).toBe("/HongKongSpam?utm_source=mpt_site&utm_medium=hk_card&utm_campaign=home");
  });

  it("uses the report placement UTM on the report page", async () => {
    stubGeo("HK");
    renderPage(<HkStopSpamCard placement="report" />);
    await screen.findByTestId("hk-card");
    expect(screen.getByRole("link").getAttribute("href")).toContain("utm_campaign=report");
  });

  it("shows other visitors a 'for Hong Kong numbers' note, and the override reveals the card", async () => {
    stubGeo("AU");
    const user = userEvent.setup();
    renderPage(<HkStopSpamCard placement="home" />);
    const note = await screen.findByTestId("hk-card-note");
    expect(note).toHaveTextContent(/for hong kong numbers/i);
    expect(screen.queryByTestId("hk-card")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I have a Hong Kong number" }));
    expect(await screen.findByTestId("hk-card")).toBeInTheDocument();
    expect(localStorage.getItem(HK_OVERRIDE_KEY)).toBe("1");
  });

  it("an existing override skips the lookup, and 'Not a Hong Kong number' undoes it", async () => {
    localStorage.setItem(HK_OVERRIDE_KEY, "1");
    const f = stubGeo("AU");
    const user = userEvent.setup();
    renderPage(<HkStopSpamCard placement="home" />);
    await screen.findByTestId("hk-card");
    expect(f).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Not a Hong Kong number" }));
    expect(await screen.findByTestId("hk-card-note")).toBeInTheDocument();
    expect(localStorage.getItem(HK_OVERRIDE_KEY)).toBeNull();
  });

  it("fails closed when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    renderPage(<HkStopSpamCard placement="home" />);
    expect(await screen.findByTestId("hk-card-note")).toBeInTheDocument();
    expect(screen.queryByTestId("hk-card")).not.toBeInTheDocument();
  });
});
