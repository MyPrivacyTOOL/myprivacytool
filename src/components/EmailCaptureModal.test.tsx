// MPC-7300: post-scan email capture -> mpt-leads Worker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse } from "@/test/render";
import EmailCaptureModal from "./EmailCaptureModal";
import { HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";
import { percentHalfUp } from "../../shared/hexagon-registry/score.js";

// MPC-7471-F1: the dialog fires confetti on open; jsdom has no canvas, so stub it everywhere in this file.
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());
const setup = (riskScore: number | null = 55) => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  render(<EmailCaptureModal riskScore={riskScore} categoryScores={{ fingerprint: 50 }} confirmedCount={23} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit, user: userEvent.setup() };
};
const email = () => screen.getByPlaceholderText("your@email.com");
const send = () => screen.getByRole("button", { name: /send my privacy check/i });

describe("EmailCaptureModal", () => {
  it.each([[85, "High exposure"], [70, "High exposure"], [69, "Medium exposure"], [40, "Medium exposure"], [39, "Low exposure"], [10, "Low exposure"]])("labels exposure score %i as %s and shows coverage", (score, label) => {
    setup(score);
    expect(screen.getByText(label)).toBeInTheDocument();
    // MPC-7471-F4: coverage = checked / the true registry total, rounded half up (the old "exposure %" was the same ratio under a misleading name).
    expect(screen.getByText(new RegExp(`${percentHalfUp(23, HEXAGON_COUNT)}% coverage`))).toBeInTheDocument();
  });

  it("with nothing checked there is no score and no band, never a Low label", () => {
    setup(null);
    expect(screen.getByText("Not enough checked to score")).toBeInTheDocument();
    expect(screen.queryByText(/Low exposure/)).not.toBeInTheDocument();
    expect(screen.getByText(/no score yet/)).toBeInTheDocument();
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
    expect(url).toContain("api.myprivacytool.io");
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "ok@example.com", riskScore: 55, scoreVersion: "exposure-v1", confirmedCount: 23, consent: true, consent_source: "web_scan_summary", categoryScores: { fingerprint: 50 },
    });
  });

  it.each([[-10, "lower"], [10, "higher"], [0, "no change"]])("describes a re-scan delta of %i", async (delta, text) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ baseline: { overall_score: 50, created_at: "2026-10-01T00:00:00Z", is_first: false, delta } })));
    const { user } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(send());
    expect(await screen.findByText(new RegExp(`Your baseline: 50/100.*${text}`))).toBeInTheDocument();
  });

  it("a baseline from another method is shown as not comparable, with no delta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ baseline: { overall_score: 85, created_at: "2026-10-01T00:00:00Z", is_first: false, delta: null, score_version: "legacy", comparable: false } })));
    const { user } = setup();
    await user.type(email(), "ok@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(send());
    expect(await screen.findByText(/used an older method, so it cannot be compared/)).toBeInTheDocument();
    expect(screen.queryByText(/points (lower|higher)|no change/)).not.toBeInTheDocument();
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

  // MPC-8368: Turnstile token is sent as cf-turnstile-response; the form waits for it only when the widget actually rendered.
  describe("Turnstile", () => {
    afterEach(() => { delete (window as unknown as { turnstile?: unknown }).turnstile; });
    const stubTurnstile = (autoToken: string | null) => {
      const render = vi.fn((_el: HTMLElement, o: { callback: (t: string) => void }) => { if (autoToken) o.callback(autoToken); return "w1"; });
      const reset = vi.fn(), remove = vi.fn();
      (window as unknown as { turnstile: unknown }).turnstile = { render, reset, remove };
      return { render, reset, remove };
    };

    it("renders the widget with the public site key and sends its token", async () => {
      const t = stubTurnstile("tok-123");
      const f = vi.fn(async () => jsonResponse({ success: true }));
      vi.stubGlobal("fetch", f);
      const { user } = setup();
      await vi.waitFor(() => expect(t.render).toHaveBeenCalled());
      expect(t.render.mock.calls[0][1]).toMatchObject({ sitekey: "0x4AAAAAAFdzq221ll_j9riV", appearance: "interaction-only" });
      await user.type(email(), "ok@example.com");
      await user.click(screen.getByRole("checkbox"));
      await user.click(send());
      await screen.findByText("You're on the list.");
      const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)["cf-turnstile-response"]).toBe("tok-123");
    });

    it("does not call the Worker until the widget has produced a token", async () => {
      const t = stubTurnstile(null);
      const f = vi.fn();
      vi.stubGlobal("fetch", f);
      const { user } = setup();
      await vi.waitFor(() => expect(t.render).toHaveBeenCalled());
      await user.type(email(), "ok@example.com");
      await user.click(screen.getByRole("checkbox"));
      await user.click(send());
      expect(await screen.findByRole("alert")).toHaveTextContent("Verifying you are human");
      expect(f).not.toHaveBeenCalled();
    });

    it("resets the widget after a 403 so the visitor can retry with a fresh token", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stubTurnstile("tok-1");
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Verification failed" }, 403)));
      const { user } = setup();
      await vi.waitFor(() => expect(t.render).toHaveBeenCalled());
      await user.type(email(), "ok@example.com");
      await user.click(screen.getByRole("checkbox"));
      await user.click(send());
      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
      expect(t.reset).toHaveBeenCalledWith("w1");
    });

    it("still submits without a token when the Turnstile script is blocked", async () => {
      const f = vi.fn(async () => jsonResponse({ success: true }));
      vi.stubGlobal("fetch", f);
      const { user } = setup();
      await user.type(email(), "ok@example.com");
      await user.click(screen.getByRole("checkbox"));
      await user.click(send());
      await screen.findByText("You're on the list.");
      const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).not.toHaveProperty("cf-turnstile-response");
    });
  });

  it("closes from the X, the backdrop and 'No thanks'", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /no thanks/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
