// MPC-7300: /start waitlist / report signup (the "First Hexagon" funnel).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Start from "./Start";

beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; });
afterEach(() => vi.unstubAllGlobals());

describe("Start", () => {
  it("submits email with the start-scan tag and consent evidence, then confirms", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /yes, that's me/i }));
    await user.type(screen.getByPlaceholderText("your@email.com"), " me@example.com ");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /check my exposure/i }));
    await screen.findByText("You're in the queue.");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/submit/246502821/22ee30ae-6cf9-419b-aa46-b656b0e7b1bf");
    const fields = Object.fromEntries(JSON.parse(init.body as string).fields.map((x: { name: string; value: string }) => [x.name, x.value]));
    expect(fields).toMatchObject({ email: "me@example.com", source_tag: "start-scan", consent_source: "start_page" });
  });

  it("surfaces a HubSpot failure and lets the user retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Rate limited" }, 429)));
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /yes, that's me/i }));
    await user.type(screen.getByPlaceholderText("your@email.com"), "me@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /check my exposure/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limited");
    expect(screen.queryByText("You're in the queue.")).not.toBeInTheDocument();
  });

  it("does not submit when consent is not ticked", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /yes, that's me/i }));
    await user.type(screen.getByPlaceholderText("your@email.com"), "me@example.com");
    await user.click(screen.getByRole("button", { name: /check my exposure/i }));
    expect(f).not.toHaveBeenCalled();
  });

  it('routes "Not me" to a fresh scan and lists the messaging channels', async () => {
    const user = userEvent.setup();
    renderPage(<Start />);
    await user.click(screen.getByRole("button", { name: /not me/i }));
    expect(screen.getByRole("link", { name: /check my exposure/i })).toHaveAttribute("href", "/scan");
    for (const n of ["WhatsApp", "Telegram", "Messenger", "Instagram", "Email"]) expect(screen.getByRole("link", { name: n })).toBeInTheDocument();
  });
});
