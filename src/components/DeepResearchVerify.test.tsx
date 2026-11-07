import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DeepResearchVerify from "./DeepResearchVerify";

vi.mock("@/components/TurnstileBox", () => ({ default: () => <div data-testid="turnstile-stub" /> }));
vi.mock("@/lib/deepResearchApi", () => ({
  deepResearchEnabled: vi.fn(),
  startCheck: vi.fn(),
  verifyCode: vi.fn(),
  loadResults: vi.fn(),
  deleteMyData: vi.fn(),
}));
import { deepResearchEnabled, startCheck, verifyCode, loadResults, deleteMyData } from "@/lib/deepResearchApi";

const finding = { id: "f1", hexagon_id: "cred_leak_trace", finding_type: "password_pwned", confidence_score: 90, remediation_link: "https://example.com/fix", created_at: "2026-11-07T00:00:00Z" };
const typeEmail = () => {
  fireEvent.change(screen.getByLabelText("Your email address"), { target: { value: "owner@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
};
const typeCode = (c = "123456") => {
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: c } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
};

describe("DeepResearchVerify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deepResearchEnabled).mockReturnValue(true);
    vi.mocked(startCheck).mockResolvedValue({ ok: true, data: { challenge_id: "cid-1" } });
    vi.mocked(verifyCode).mockResolvedValue({ ok: true, data: { token: "tok", expires_in: 3600 } });
    vi.mocked(loadResults).mockResolvedValue({ ok: true, data: { findings: [finding], retention_days: 90, min_confidence: 80 } });
    vi.mocked(deleteMyData).mockResolvedValue({ ok: true, data: { deleted: 1 } });
  });

  it("shows only an 'opens soon' note, and no form, while the flag is off", () => {
    vi.mocked(deepResearchEnabled).mockReturnValue(false);
    render(<DeepResearchVerify />);
    expect(screen.getByTestId("deep-verify-off").textContent).toMatch(/opens soon/i);
    expect(screen.queryByLabelText("Your email address")).toBeNull();
    expect(startCheck).not.toHaveBeenCalled();
  });

  it("walks email -> code -> results and shows this person's findings with the retention period", async () => {
    render(<DeepResearchVerify />);
    typeEmail();
    await waitFor(() => expect(screen.getByLabelText("6-digit code")).toBeTruthy());
    expect(startCheck).toHaveBeenCalledWith("owner@example.com", "");
    typeCode();
    await waitFor(() => expect(screen.getByTestId("deep-findings")).toBeTruthy());
    expect(verifyCode).toHaveBeenCalledWith("cid-1", "owner@example.com", "123456");
    expect(loadResults).toHaveBeenCalledWith("tok");
    expect(screen.getByText("Credential & Identity Leak Tracing")).toBeTruthy();
    expect(screen.getByText(/90% sure/)).toBeTruthy();
    expect(screen.getByText(/keep results for 90 days/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "How to fix this" }).getAttribute("href")).toBe("https://example.com/fix");
  });

  it("never renders a non-https remediation link", async () => {
    vi.mocked(loadResults).mockResolvedValue({ ok: true, data: { findings: [{ ...finding, remediation_link: "javascript:alert(1)" }], retention_days: 90, min_confidence: 80 } });
    render(<DeepResearchVerify />);
    typeEmail();
    await waitFor(() => screen.getByLabelText("6-digit code"));
    typeCode();
    await waitFor(() => screen.getByTestId("deep-findings"));
    expect(screen.queryByRole("link", { name: "How to fix this" })).toBeNull();
  });

  it("says plainly when nothing was found yet", async () => {
    vi.mocked(loadResults).mockResolvedValue({ ok: true, data: { findings: [], retention_days: 90, min_confidence: 80 } });
    render(<DeepResearchVerify />);
    typeEmail();
    await waitFor(() => screen.getByLabelText("6-digit code"));
    typeCode();
    await waitFor(() => expect(screen.getByTestId("deep-empty").textContent).toMatch(/nothing found yet/i));
  });

  it("keeps the person on the code step after a wrong code, and sends them back to the start when the code is dead", async () => {
    vi.mocked(verifyCode).mockResolvedValueOnce({ ok: false, error: "That code is not right.", status: "wrong" });
    render(<DeepResearchVerify />);
    typeEmail();
    await waitFor(() => screen.getByLabelText("6-digit code"));
    typeCode("000000");
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not right/));
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
    expect(loadResults).not.toHaveBeenCalled();
    vi.mocked(verifyCode).mockResolvedValueOnce({ ok: false, error: "Too many wrong tries. Ask for a new code.", status: "locked" });
    typeCode("111111");
    await waitFor(() => expect(screen.getByLabelText("Your email address")).toBeTruthy());
  });

  it("shows the server's message when the code cannot be sent", async () => {
    vi.mocked(startCheck).mockResolvedValue({ ok: false, error: "Too many codes requested for this address. Try again in an hour." });
    render(<DeepResearchVerify />);
    typeEmail();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Try again in an hour/));
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  it("opens a Coming soon popup for the phone step, and deletes the person's data on request", async () => {
    render(<DeepResearchVerify />);
    typeEmail();
    await waitFor(() => screen.getByLabelText("6-digit code"));
    typeCode();
    await waitFor(() => screen.getByTestId("deep-findings"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock phone-based checks" }));
    expect(screen.getByText("Phone verification: coming soon")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete my data" }));
    await waitFor(() => expect(screen.getByLabelText("Your email address")).toBeTruthy());
    expect(deleteMyData).toHaveBeenCalledWith("tok");
    expect(screen.getByRole("status").textContent).toMatch(/deleted/i);
  });
});
