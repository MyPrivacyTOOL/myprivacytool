// MPC-9825: /business 48-hour copy and the form -> queue path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage, jsonResponse } from "@/test/render";
import Business from "./Business";

let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/business-request")) return jsonResponse({ success: true, ref: "BIZ-ABCD2345", due_at: "2026-11-10T00:00:00Z" });
    return jsonResponse({}); // HubSpot
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByPlaceholderText("Work email"), { target: { value: "ada@acme.example" } });
  fireEvent.change(screen.getByPlaceholderText("Company name"), { target: { value: "Acme Ltd" } });
  fireEvent.click(screen.getByRole("checkbox"));
};

describe("/business 48-hour line (MPC-9825)", () => {
  it("carries no status marker on the 48-hour lines, and states what is included today", () => {
    const { container } = renderPage(<Business />);
    const small = screen.getByText(/No payment required\. Results in 48 hours\./);
    expect(small.querySelector("[data-feature-status]")).toBeNull();
    const blurb = screen.getByText(/team exposure summary within 48 hours/);
    expect(blurb.textContent).toMatch(/a person prepares it by hand/);
    expect(blurb.textContent).toMatch(/free browser and email scan/);
    // the only marker inside the blurb is the pinned Planned marker on data-broker coverage
    const inBlurb = blurb.querySelectorAll("[data-feature-status]");
    expect(inBlurb).toHaveLength(1);
    expect(inBlurb[0].getAttribute("data-feature-status")).toBe("planned");
    expect(blurb.textContent).toMatch(/data-broker coverage is\s*Planned/);
    // everything else keeps its markers (monthly scan, removals, alerts, API, SSO and the scan/removal/monitoring steps)
    expect(container.querySelectorAll('[data-feature="F6"]').length).toBeGreaterThanOrEqual(8);
  });
});

describe("/business form -> queue row (MPC-9825)", () => {
  it("queues the request first, then sends it to HubSpot, and shows the reference", async () => {
    renderPage(<Business />);
    fill();
    fireEvent.submit(screen.getByPlaceholderText("Work email").closest("form")!);
    await screen.findByText("Request received");
    expect(urls()[0]).toMatch(/\/business-request$/);
    expect(urls()[1]).toMatch(/hsforms\.com/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ name: "Ada Lovelace", email: "ada@acme.example", company: "Acme Ltd", consent: true, consent_source: "business_page" });
    expect(screen.getByText("BIZ-ABCD2345")).toBeInTheDocument();
  });

  it("does not acknowledge, and does not send to HubSpot, when the queue write fails", async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes("/business-request") ? jsonResponse({ error: "Queue write failed" }, 502) : jsonResponse({})));
    renderPage(<Business />);
    fill();
    fireEvent.submit(screen.getByPlaceholderText("Work email").closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no 48-hour timer has started/));
    expect(screen.queryByText("Request received")).toBeNull();
    expect(urls().some((u) => /hsforms\.com/.test(u))).toBe(false);
  });
});
