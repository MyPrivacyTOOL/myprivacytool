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
});

describe("Pricing waitlist (MPC-7626)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits to HubSpot with the pricing-waitlist source tag and fires pricing_waitlist_signup", async () => {
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
      email: "ada@example.com", plan_interest: "executive", source_tag: "pricing-waitlist", consent_source: "pricing_waitlist",
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
