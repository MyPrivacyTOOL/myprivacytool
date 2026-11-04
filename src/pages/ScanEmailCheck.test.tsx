// MPC-8453: a refused address gets an honest message (not the generic failure), and a common typo gets one "did you mean ...?" before anything is sent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";
import { BAD_EMAIL_MESSAGE, REPORT_FAILED_MESSAGE } from "@/lib/scanReport";

beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const MARKETING = /email me my results and occasional privacy tips/i;
const setup = (worker: () => Response) => {
  const f = vi.fn(async (url: unknown) => (String(url).endsWith("/api/scan") ? worker() : jsonResponse({ inlineMessage: "ok" })));
  vi.stubGlobal("fetch", f);
  return f;
};
const workerCalls = (f: ReturnType<typeof setup>) => f.mock.calls.filter((c) => String(c[0]).endsWith("/api/scan")).length;
async function typeEmail(user: ReturnType<typeof userEvent.setup>, email: string) {
  const box = screen.getAllByLabelText("Email address")[0];
  await user.clear(box);
  await user.type(box, email);
}
const press = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);

describe("Scan page: bad addresses (MPC-8453)", () => {
  it("a domain the Worker refuses shows the specific message, no thank-you, and keeps the address for a fix", async () => {
    const f = setup(() => jsonResponse({ error: "That email address does not look right", code: "bad_email_domain", reason: "no_such_domain" }, 400));
    const user = userEvent.setup();
    renderPage(<Scan />);
    await typeEmail(user, "wqefsda@made-up-domain.example");
    await user.click(screen.getAllByLabelText(MARKETING)[0]);
    await press(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(BAD_EMAIL_MESSAGE);
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getAllByLabelText("Email address")[0] as HTMLInputElement).value).toBe("wqefsda@made-up-domain.example");
    expect(workerCalls(f)).toBe(1);
  });

  it("another 400 (not the domain check) keeps the generic message", async () => {
    setup(() => jsonResponse({ error: "Consent required" }, 400));
    const user = userEvent.setup();
    renderPage(<Scan />);
    await typeEmail(user, "someone@example.org");
    await user.click(screen.getAllByLabelText(MARKETING)[0]);
    await press(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(REPORT_FAILED_MESSAGE);
  });

  it("a common typo gets one 'did you mean', sends nothing, and the same address then goes through", async () => {
    const f = setup(() => jsonResponse({ success: true }));
    const user = userEvent.setup();
    renderPage(<Scan />);
    await typeEmail(user, "jane@gmial.com");
    await user.click(screen.getAllByLabelText(MARKETING)[0]);
    await press(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Did you mean jane@gmail.com?");
    expect(workerCalls(f)).toBe(0);
    await press(user);
    expect(await screen.findByRole("status")).toHaveTextContent(/we have your email/i);
    expect(workerCalls(f)).toBe(1);
  });

  it("fixing the typo sends straight away with no hint", async () => {
    const f = setup(() => jsonResponse({ success: true }));
    const user = userEvent.setup();
    renderPage(<Scan />);
    await typeEmail(user, "jane@gmial.com");
    await user.click(screen.getAllByLabelText(MARKETING)[0]);
    await press(user);
    await screen.findByRole("alert");
    await typeEmail(user, "jane@gmail.com");
    await press(user);
    expect(await screen.findByRole("status")).toHaveTextContent(/we have your email/i);
    expect(workerCalls(f)).toBe(1);
  });
});
