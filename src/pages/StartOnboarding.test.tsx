import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Start from "./Start";
import ThankYou from "./ThankYou";

const submitHubSpotForm = vi.fn();
const analytics = vi.hoisted(() => ({
  trackStartSignup: vi.fn(),
  trackExperimentExposure: vi.fn(),
  trackExperimentCta: vi.fn(),
  trackFormValidationError: vi.fn(),
  trackFormSubmitError: vi.fn(),
  trackThankYouView: vi.fn(),
  trackThankYouNextStep: vi.fn(),
}));

vi.mock("@/lib/hubspot", () => ({
  submitHubSpotForm: (...a: unknown[]) => submitHubSpotForm(...a),
  consentFields: () => ({ consent_given_at: "0", consent_source: "start_page" }),
}));
vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/components/Seo", () => ({ default: () => null }));

const renderStart = (url = "/start") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/start" element={<Start />} />
        <Route path="/thank-you" element={<ThankYou />} />
      </Routes>
    </MemoryRouter>,
  );

const openForm = () => fireEvent.click(screen.getByRole("button", { name: /yes, that's me/i }));

describe("/start onboarding form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.pushState({}, "", "/");
    window.scrollTo = vi.fn();
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });

  it("shows inline errors and does not submit an invalid form", () => {
    renderStart();
    openForm();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /check my exposure/i }));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/doesn't look like an email/i);
    expect(submitHubSpotForm).not.toHaveBeenCalled();
    expect(analytics.trackFormValidationError).toHaveBeenCalledWith("start_scan", "email");
  });

  it("requires consent with a visible message", () => {
    renderStart();
    openForm();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /check my exposure/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/tick the box/i);
    expect(submitHubSpotForm).not.toHaveBeenCalled();
  });

  it("submits once, fires generate_lead tracking, and lands on the thank-you page", async () => {
    submitHubSpotForm.mockResolvedValue(undefined);
    renderStart();
    openForm();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: " me@example.com " } });
    fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: /check my exposure/i });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("heading", { name: /you're on the list/i })).toBeInTheDocument());
    expect(submitHubSpotForm).toHaveBeenCalledTimes(1);
    expect(submitHubSpotForm.mock.calls[0][0].fields).toMatchObject({ email: "me@example.com", source_tag: "start-scan" });
    expect(analytics.trackStartSignup).toHaveBeenCalledTimes(1);
    expect(analytics.trackStartSignup).toHaveBeenCalledWith(expect.objectContaining({ experiment_id: "start_cta", variant_id: "control" }));
  });

  it("keeps the visitor's input and explains a failed submit", async () => {
    submitHubSpotForm.mockRejectedValue(new TypeError("Failed to fetch"));
    renderStart();
    openForm();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /check my exposure/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't reach our server/i));
    expect(screen.getByLabelText(/email address/i)).toHaveValue("me@example.com");
    expect(analytics.trackStartSignup).not.toHaveBeenCalled();
    expect(analytics.trackFormSubmitError).toHaveBeenCalledWith("start_scan");
  });

  it("shows the variant button copy when forced via URL and does not count it", () => {
    window.history.pushState({}, "", "/start?ab_start_cta=early_access"); // abTest reads window.location
    renderStart();
    openForm();
    expect(screen.getByRole("button", { name: /get early access, free/i })).toBeInTheDocument();
    expect(analytics.trackExperimentExposure).toHaveBeenCalledWith("start_cta", "early_access", true);
  });
});

describe("/thank-you", () => {
  it("renders source-specific copy, next steps and trust links, without claiming an email was sent", () => {
    render(
      <MemoryRouter initialEntries={["/thank-you?source=contact"]}>
        <Routes>
          <Route path="/thank-you" element={<ThankYou />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /message sent/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /opt-out guides|remove your data yourself/i })).toHaveAttribute("href", "/opt-out-guides");
    expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute("href", "/privacy");
    expect(screen.queryByText(/welcome email is on its way/i)).toBeNull();
    expect(screen.getByRole("link", { name: /developer docs/i })).toHaveAttribute("href", "/developers");
    expect(analytics.trackThankYouView).toHaveBeenCalledWith("contact", undefined);
  });

  it("falls back to generic copy for unknown sources", () => {
    render(
      <MemoryRouter initialEntries={["/thank-you?source=<script>"]}>
        <Routes>
          <Route path="/thank-you" element={<ThankYou />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /you're all set/i })).toBeInTheDocument();
    expect(analytics.trackThankYouView).toHaveBeenCalledWith("other", undefined);
  });
});
