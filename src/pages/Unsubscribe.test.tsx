// /unsubscribe: confirm button for email links (opt-out only on click), and a request form that emails a confirmation link.
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Unsubscribe from "./Unsubscribe";

afterEach(() => vi.unstubAllGlobals());

describe("Unsubscribe", () => {
  it("from an email link: nothing is sent until the button is pressed, then it opts out", async () => {
    const f = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Unsubscribe />, "/unsubscribe?e=a%40b.co&t=abc123");
    expect(f).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /yes, unsubscribe me/i }));
    expect(await screen.findByRole("heading", { name: /you are unsubscribed/i })).toBeInTheDocument();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/unsubscribe\?e=a%40b\.co&t=abc123$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
  });

  it("an invalid or expired link says so and offers the request form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false }, 400)));
    const user = userEvent.setup();
    renderPage(<Unsubscribe />, "/unsubscribe?e=a%40b.co&t=bad");
    await user.click(screen.getByRole("button", { name: /yes, unsubscribe me/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid|out of date/i);
    expect(screen.getByRole("button", { name: /email me a confirmation link/i })).toBeInTheDocument();
  });

  it("without a link: validates the address, then asks for a confirmation email", async () => {
    const f = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderPage(<Unsubscribe />, "/unsubscribe");
    await user.click(screen.getByRole("button", { name: /email me a confirmation link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/enter your email/i);
    expect(f).not.toHaveBeenCalled();
    await user.type(screen.getByPlaceholderText("your@email.com"), "n@example.com");
    await user.click(screen.getByRole("button", { name: /email me a confirmation link/i }));
    expect(await screen.findByRole("heading", { name: /check your inbox/i })).toBeInTheDocument();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/unsubscribe-request$/);
    expect(JSON.parse(init.body as string)).toEqual({ email: "n@example.com" });
  });

  it("shows a rate-limit message and a generic error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 429)));
    const { unmount } = renderPage(<Unsubscribe />, "/unsubscribe");
    await user.type(screen.getByPlaceholderText("your@email.com"), "n@example.com");
    await user.click(screen.getByRole("button", { name: /email me a confirmation link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many requests/i);
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    renderPage(<Unsubscribe />, "/unsubscribe");
    await user.type(screen.getByPlaceholderText("your@email.com"), "n@example.com");
    await user.click(screen.getByRole("button", { name: /email me a confirmation link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
  });
});
