// MPC-7300: post-scan email capture -> mpt-leads Worker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse } from "@/test/render";
import EmailCaptureModal from "./EmailCaptureModal";

afterEach(() => vi.unstubAllGlobals());
const setup = (riskScore = 55) => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  render(<EmailCaptureModal riskScore={riskScore} categoryScores={{ fingerprint: 50 }} confirmedCount={23} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit, user: userEvent.setup() };
};
const email = () => screen.getByPlaceholderText("your@email.com");
const send = () => screen.getByRole("button", { name: /send my privacy check/i });

describe("EmailCaptureModal", () => {
  it.each([[75, "High Risk"], [50, "Medium Risk"], [10, "Low Risk"]])("labels risk %i as %s and shows exposure", (score, label) => {
    setup(score);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/50% exposure/)).toBeInTheDocument();
  });

  it("validates the email and requires consent before calling the Worker", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { user } = setup();
    await user.type(email(), "a@b");
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("valid email");
    await user.clear(email());
    await user.type(email(), "ok@example.com");
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("tick the box");
    expect(f).not.toHaveBeenCalled();
  });

  it("posts scores + explicit consent and shows the first-scan baseline", async () => {
    const f = vi.fn(async () => jsonResponse({ success: true, baseline: { overall_score: 55, created_at: "2026-10-06T00:00:00Z", is_first: true, delta: 0 } }));
    vi.stubGlobal("fetch", f);
    const { user, onSubmit } = setup();
    await user.type(email(), " ok@example.com ");
    await user.click(screen.getByRole("checkbox"));
    await user.click(send());
    await screen.findByText("You're on the list.");
    expect(screen.getByText(/Baseline saved: 55\/100/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith("ok@example.com");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("mpt-leads");
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "ok@example.com", riskScore: 55, confirmedCount: 23, consent: true, consent_source: "web_scan_summary", categoryScores: { fingerprint: 50 },
    });
  });

  it.each([[-10, "lower (better)"], [10, "higher (worse)"], [0, "no change"]])("describes a re-scan delta of %i", async (delta, text) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ baseline: { overall_score: 50, created_at: "2026-10-01T00:00:00Z", is_first: false, delta } })));
    const { user } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(send());
    expect(await screen.findByText(new RegExp(`Your baseline: 50/100.*${text.replace(/[()]/g, "\\$&")}`))).toBeInTheDocument();
  });

  it("shows an error when the Worker fails, and tolerates a non-JSON success body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const a = setup();
    await a.user.type(email(), "ok@example.com");
    await a.user.click(screen.getByRole("checkbox"));
    await a.user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("closes from the X, the backdrop and 'No thanks'", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /no thanks/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
