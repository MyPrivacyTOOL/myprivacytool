import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Header from "./Header";
import { renderPage } from "@/test/render";

const trackEvent = vi.fn();
const trackExperimentCta = vi.fn();
vi.mock("@/lib/analytics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/analytics")>("@/lib/analytics");
  return { ...actual, trackEvent: (...a: unknown[]) => trackEvent(...a), trackExperimentCta: (...a: unknown[]) => trackExperimentCta(...a) };
});

// The experiment reads the real URL (window.location.search), not the router's, so set both.
const visit = (path: string) => {
  window.history.replaceState({}, "", path);
  return renderPage(<Header />, path);
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("<Header /> mobile_hive header button", () => {
  it("is absent for the control and when the experiment is off (the default)", () => {
    const first = visit("/");
    expect(screen.queryByTestId("header-phone-cta")).toBeNull();
    first.unmount();
    visit("/?ab_mobile_hive=control");
    expect(screen.queryByTestId("header-phone-cta")).toBeNull();
  });

  it("shows in the test group, links to /scan and reports the click with its variant", async () => {
    visit("/?ab_mobile_hive=readable_tiles");
    const cta = screen.getByTestId("header-phone-cta");
    expect(cta).toHaveAttribute("href", "/scan");
    await userEvent.click(cta);
    // A forced (QA) view is never counted: the click handler runs but reports nothing to GA4 results.
    expect(trackExperimentCta).toHaveBeenCalledWith("mobile_hive", "readable_tiles", true);
    expect(trackEvent).not.toHaveBeenCalledWith("header_cta_click", expect.anything());
  });

  it("is not shown on /scan, where the button would point at the page you are on", () => {
    visit("/scan?ab_mobile_hive=readable_tiles");
    expect(screen.queryByTestId("header-phone-cta")).toBeNull();
  });
});
