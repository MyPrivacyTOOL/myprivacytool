import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Enterprise from "./Enterprise";

const submit = vi.fn();
const track = vi.fn();
vi.mock("@/lib/hubspot", () => ({
  submitHubSpotForm: (...a: unknown[]) => submit(...a),
  consentFields: () => ({ consent_given_at: "0", consent_source: "enterprise_page" }),
}));
vi.mock("@/lib/analytics", () => ({ trackEnterpriseLead: (...a: unknown[]) => track(...a) }));
vi.mock("@/components/Seo", () => ({ default: () => null }));

beforeEach(() => {
  submit.mockReset();
  track.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("Work email"), { target: { value: "a@corp.com" } });
  fireEvent.change(screen.getByPlaceholderText("Company name"), { target: { value: "Corp" } });
  fireEvent.click(screen.getByRole("checkbox"));
};

describe("Enterprise page", () => {
  it("submits with the enterprise-demo source tag and tracks the lead", async () => {
    submit.mockResolvedValue(undefined);
    render(<MemoryRouter><Enterprise /></MemoryRouter>);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Request a demo" }));
    await waitFor(() => expect(screen.getByText("Request received")).toBeTruthy());
    expect(submit.mock.calls[0][0].fields.source_tag).toBe("enterprise-demo");
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does not track when the submit fails", async () => {
    submit.mockRejectedValue(new Error("boom"));
    render(<MemoryRouter><Enterprise /></MemoryRouter>);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Request a demo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("boom"));
    expect(track).not.toHaveBeenCalled();
  });
});
