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

describe("Pricing family add-on (MPC-7650)", () => {
  it("shows the family member add-on price and the privacy rule", () => {
    renderPage(<Pricing />);
    expect(screen.getByRole("heading", { name: /family members on pro and executive/i })).toBeTruthy();
    expect(screen.getByText(/\$5\/month each/)).toBeTruthy();
    expect(screen.getByText(/adults keep their reports private/)).toBeTruthy();
  });
});
