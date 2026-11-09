// MPC-7300: /start waitlist / report signup (the "First Hexagon" funnel).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Start from "./Start";
import { CHANNEL_STATUS } from "@/config/featureStatus";

beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; });
afterEach(() => vi.unstubAllGlobals());

describe("Start", () => {
  it("submits email with the start-scan tag and consent evidence, then confirms", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /join the list/i }));
    await user.type(screen.getByPlaceholderText("your@email.com"), " me@example.com ");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /check my exposure/i }));
    await screen.findByRole("button", { name: /you're in/i }); // success state; the page then redirects to /thank-you
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/submit/246502821/22ee30ae-6cf9-419b-aa46-b656b0e7b1bf");
    const fields = Object.fromEntries(JSON.parse(init.body as string).fields.map((x: { name: string; value: string }) => [x.name, x.value]));
    expect(fields).toMatchObject({ email: "me@example.com", source_tag: "start-scan", consent_source: "start_page" });
  });

  it("surfaces a HubSpot failure and lets the user retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Rate limited" }, 429)));
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /join the list/i }));
    await user.type(screen.getByPlaceholderText("your@email.com"), "me@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /check my exposure/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limited");
    expect(screen.queryByRole("button", { name: /you're in/i })).not.toBeInTheDocument();
  });

  it("does not submit when consent is not ticked", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /join the list/i }));
    await user.type(screen.getByPlaceholderText("your@email.com"), "me@example.com");
    await user.click(screen.getByRole("button", { name: /check my exposure/i }));
    expect(f).not.toHaveBeenCalled();
  });

  it('routes "Not now" to the scan', async () => {
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.getByRole("link", { name: /check my exposure/i })).toHaveAttribute("href", "/scan");
  });

  // MPC-9826: every channel card takes its state from CHANNEL_STATUS; a channel that is not live is never a link.
  it("shows six channel cards whose state and markers come from CHANNEL_STATUS", () => {
    const { container } = renderPage(<Start />);
    const names: Record<string, string> = { web: "Web", telegram: "Telegram", email: "Email", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram" };
    expect(Object.keys(CHANNEL_STATUS).sort()).toEqual(Object.keys(names).sort());
    for (const [id, name] of Object.entries(names)) {
      const state = CHANNEL_STATUS[id as keyof typeof CHANNEL_STATUS];
      const marker = container.querySelector(`[data-channel="${id}"]`);
      if (state === "live") {
        expect(marker).toBeNull();
        expect(screen.getByRole("link", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
      } else {
        expect(marker).toHaveAttribute("data-feature-status", state);
        expect(marker).toHaveTextContent(state === "planned" ? "Planned" : "In build");
      }
      if (state === "planned") {
        expect(screen.queryByRole("link", { name: new RegExp(`^${name}`) })).toBeNull();
        expect(container.querySelector(`[data-channel-card="${id}"]`)).toHaveAttribute("aria-disabled", "true");
      }
    }
  });

  it("states the six channels exactly as Chris decided (MPC-9826, 2026-11-07)", () => {
    expect(CHANNEL_STATUS).toEqual({ web: "live", telegram: "live", email: "live", whatsapp: "planned", messenger: "planned", instagram: "planned" });
  });
});
