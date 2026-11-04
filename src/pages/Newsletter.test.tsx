// MPC-7300: /newsletter signup writes to the Supabase `subscribers` table through PostgREST.
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Newsletter from "./Newsletter";

afterEach(() => vi.unstubAllGlobals());
const submit = async (email = "n@example.com") => {
  const user = userEvent.setup();
  renderPage(<Newsletter />);
  await user.type(screen.getByPlaceholderText("your@email.com"), email);
  await user.click(screen.getByRole("button", { name: /subscribe to privacy check/i }));
};

describe("Newsletter", () => {
  it("inserts the subscriber with consent evidence and shows success", async () => {
    const f = vi.fn(async () => jsonResponse({}, 201));
    vi.stubGlobal("fetch", f);
    await submit();
    await screen.findByText(/you're in|subscribed|welcome/i);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/rest\/v1\/subscribers$/);
    expect((init.headers as Record<string, string>).Prefer).toBe("return=minimal");
    expect(JSON.parse(init.body as string)).toMatchObject({ email: "n@example.com", consent_source: "newsletter_page" });
  });
  it("treats a duplicate email (23505 / 409) as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "23505" }, 409)));
    await submit();
    await screen.findByText(/you're in|subscribed|welcome/i);
  });
  it("shows the server error otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "permission denied" }, 401)));
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });
  it("shows a generic error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw "x"; }));
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
