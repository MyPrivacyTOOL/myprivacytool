import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Pricing from "./Pricing";

let gtag: ReturnType<typeof vi.fn>;
const eventNames = () => gtag.mock.calls.filter((c) => c[0] === "event").map((c) => c[1]);

beforeEach(() => {
  gtag = vi.fn();
  window.gtag = gtag;
});
afterEach(() => {
  delete window.gtag;
});

describe("Pricing analytics (MPC-7376)", () => {
  it("fires pricing_view once on load", () => {
    renderPage(<Pricing />);
    expect(eventNames()).toEqual(["pricing_view"]);
  });

  it("fires pricing_plan_click with the plan and destination", () => {
    renderPage(<Pricing />);
    fireEvent.click(screen.getAllByRole("link", { name: "Get launch updates" })[1]);
    expect(gtag).toHaveBeenLastCalledWith("event", "pricing_plan_click", {
      plan: "pro",
      cta_location: "pricing_card",
      destination: "/newsletter",
    });
  });
});

describe("Pricing A/B tests (MPC-7638)", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("serves the control and sends no experiment events while the tests are off", () => {
    renderPage(<Pricing />);
    expect(screen.getByRole("heading", { level: 1, name: "Pricing" })).toBeTruthy();
    expect(screen.queryByText("The scan is free and needs no credit card.")).toBeNull();
    expect(eventNames()).toEqual(["pricing_view"]);
  });

  it("shows forced variants without counting them", () => {
    // The hook reads window.location.search, not the router, so set the real URL.
    window.history.replaceState({}, "", "/pricing?ab_pricing_headline=free_first&ab_pricing_cta=notify_text&ab_pricing_social_proof=above_plans");
    renderPage(<Pricing />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Know your exposure for free. Pay to remove it.");
    expect(screen.getAllByRole("link", { name: "Notify me when plans open" })).toHaveLength(3);
    expect(screen.getByText("The scan is free and needs no credit card.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("link", { name: "Notify me when plans open" })[0]);
    expect(eventNames()).toEqual(["pricing_view", "pricing_plan_click"]);
    expect(gtag).toHaveBeenLastCalledWith("event", "pricing_plan_click", expect.not.objectContaining({ ab_pricing_cta: expect.anything() }));
  });
});
