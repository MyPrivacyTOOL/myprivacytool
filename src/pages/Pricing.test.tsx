import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
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
    fireEvent.click(screen.getAllByRole("button", { name: "Join the waitlist" })[1]);
    expect(gtag).toHaveBeenLastCalledWith("event", "pricing_plan_click", {
      plan: "pro",
      cta_location: "pricing_card",
      destination: "#waitlist",
    });
    expect(screen.getByLabelText("Plan")).toHaveValue("Pro");
  });

  // CK-7721 C: real plan interest, the only valid price evidence while paid plans are not open. No personal data in the event.
  it("fires pricing_plan_click for the business quote link", () => {
    renderPage(<Pricing />);
    fireEvent.click(screen.getByRole("link", { name: "Talk to us about business plans" }));
    expect(gtag).toHaveBeenLastCalledWith("event", "pricing_plan_click", { plan: "business", cta_location: "pricing_card", destination: "/business" });
  });

  it("sends nothing and does not throw when analytics consent was not given (no gtag)", () => {
    delete window.gtag;
    renderPage(<Pricing />);
    expect(() => fireEvent.click(screen.getAllByRole("button", { name: "Join the waitlist" })[1])).not.toThrow();
    expect(() => fireEvent.click(screen.getByRole("link", { name: "Talk to us about business plans" }))).not.toThrow();
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe("Pricing waitlist (MPC-7626)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits to HubSpot with the plan in the pricing-waitlist source tag and fires pricing_waitlist_signup", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Pricing />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.selectOptions(screen.getByLabelText("Plan"), "Executive");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getAllByRole("button", { name: "Join the waitlist" }).at(-1)!);
    await waitFor(() => expect(eventNames()).toContain("pricing_waitlist_signup"));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/submit/246502821/");
    const fields = Object.fromEntries(JSON.parse(init.body as string).fields.map((x: { name: string; value: string }) => [x.name, x.value]));
    expect(fields).toMatchObject({
      email: "ada@example.com", plan_interest: "executive", source_tag: "pricing-waitlist-executive", consent_source: "pricing_waitlist",
    });
    expect(gtag).toHaveBeenCalledWith("event", "pricing_waitlist_signup", expect.objectContaining({ plan: "executive" }));
  });

  it("blocks submit without consent and does not call HubSpot", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Pricing />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getAllByRole("button", { name: "Join the waitlist" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tick the box");
    expect(f).not.toHaveBeenCalled();
    expect(eventNames()).not.toContain("pricing_waitlist_signup");
  });

  it("shows the FAQ block", () => {
    renderPage(<Pricing />);
    expect(screen.getByText("Can I cancel anytime?")).toBeInTheDocument();
    expect(screen.getByText("What data do you keep if I join the waitlist?")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Know your exposure for free. Removal is planned.");
    expect(screen.getAllByRole("button", { name: "Notify me when plans open" })).toHaveLength(3);
    expect(screen.getByText("The scan is free and needs no credit card.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Notify me when plans open" })[0]);
    expect(eventNames()).toEqual(["pricing_view", "pricing_plan_click"]);
    expect(gtag).toHaveBeenLastCalledWith("event", "pricing_plan_click", expect.not.objectContaining({ ab_pricing_cta: expect.anything() }));
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
