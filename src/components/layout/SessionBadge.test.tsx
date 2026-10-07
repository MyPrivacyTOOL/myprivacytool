import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionBadge from "./SessionBadge";
import * as api from "@/lib/oauthSession";
import { renderPage } from "@/test/render";

vi.mock("@/lib/oauthSession", async () => {
  const actual = await vi.importActual<typeof import("@/lib/oauthSession")>("@/lib/oauthSession");
  return { ...actual, fetchSession: vi.fn(), signOut: vi.fn() };
});

const connected = (email = "ann@example.com", expiresAt: number | null = null) =>
  ({ status: "connected", email, expiresAt }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
describe("<SessionBadge />", () => {
  it("renders nothing and makes no request for a visitor who has not signed in", async () => {
    const { container } = renderPage(<SessionBadge />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(api.fetchSession).not.toHaveBeenCalled();
  });

  it("shows 'Connected as <email>' and a Sign out button when a session exists", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue(connected());
    renderPage(<SessionBadge />);
    expect(await screen.findByText("ann@example.com")).toBeInTheDocument();
    expect(screen.getByText("Connected as")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("remembers a sign-in return (?channel=google) and then checks the session", async () => {
    vi.mocked(api.fetchSession).mockResolvedValue(connected());
    renderPage(<SessionBadge />, "/?channel=google");
    expect(await screen.findByText("ann@example.com")).toBeInTheDocument();
    expect(api.hasSessionHint()).toBe(true);
  });

  it("does not remember a failed sign-in return (?oauth_error=)", async () => {
    const { container } = renderPage(<SessionBadge />, "/?channel=google&oauth_error=email_not_verified");
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(api.hasSessionHint()).toBe(false);
    expect(api.fetchSession).not.toHaveBeenCalled();
  });

  it("hides the badge and forgets the hint when the Worker says there is no session", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue({ status: "disconnected" });
    const { container } = renderPage(<SessionBadge />);
    await waitFor(() => expect(api.fetchSession).toHaveBeenCalled());
    await waitFor(() => expect(api.hasSessionHint()).toBe(false));
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the badge but keeps the hint when the Worker is unreachable", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue({ status: "error" });
    const { container } = renderPage(<SessionBadge />);
    await waitFor(() => expect(api.fetchSession).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(api.hasSessionHint()).toBe(true);
  });

  it("Sign out hides the badge and clears the hint", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue(connected());
    vi.mocked(api.signOut).mockResolvedValue(true);
    renderPage(<SessionBadge />);
    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.queryByText("ann@example.com")).toBeNull());
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(api.hasSessionHint()).toBe(false);
  });

  it("keeps the badge and says so when sign out fails", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue(connected());
    vi.mocked(api.signOut).mockResolvedValue(false);
    renderPage(<SessionBadge />);
    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't sign out/i);
    expect(screen.getByText("ann@example.com")).toBeInTheDocument();
    expect(api.hasSessionHint()).toBe(true);
  });

  it("hides itself when the one-hour session expires", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue(connected("ann@example.com", Date.now() + 150));
    renderPage(<SessionBadge />);
    expect(await screen.findByText("ann@example.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("ann@example.com")).toBeNull());
    expect(api.hasSessionHint()).toBe(false);
  });

  it("shows the full email in a tooltip so long addresses can truncate visually", async () => {
    api.setSessionHint();
    vi.mocked(api.fetchSession).mockResolvedValue(connected("a.very.long.address.indeed@subdomain.example.com"));
    renderPage(<SessionBadge />);
    const el = await screen.findByText("a.very.long.address.indeed@subdomain.example.com");
    expect(el.closest("[title]")).toHaveAttribute("title", "a.very.long.address.indeed@subdomain.example.com");
  });
});
