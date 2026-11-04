import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionBadge from "./SessionBadge";
import * as api from "@/lib/oauthSession";
import { renderPage } from "@/test/render";
import { useLocation } from "react-router-dom";

const LocationProbe = () => {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}${l.hash}`}</output>;
};
const renderWithProbe = (route: string) =>
  renderPage(
    <>
      <SessionBadge />
      <LocationProbe />
    </>,
    route,
  );

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

  it("a failed sign-in shows a friendly dismissible message, remembers nothing, and asks nothing", async () => {
    renderPage(<SessionBadge />, "/?channel=google&oauth_error=access_denied");
    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled the google sign-in/i);
    expect(document.body.textContent).not.toContain("access_denied");
    expect(api.hasSessionHint()).toBe(false);
    expect(api.fetchSession).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /dismiss message/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removes the sign-in marker from the address bar but keeps other parameters and the hash", async () => {
    vi.mocked(api.fetchSession).mockResolvedValue(connected());
    renderWithProbe("/pricing?utm_source=ad&channel=google#plans");
    await screen.findByText("ann@example.com");
    expect(screen.getByTestId("loc")).toHaveTextContent("/pricing?utm_source=ad#plans");
  });

  it("also tidies the address bar after a failed sign-in, keeping the message", async () => {
    renderWithProbe("/?channel=google&oauth_error=email_not_verified");
    await screen.findByRole("alert");
    expect(screen.getByTestId("loc")).toHaveTextContent(/^\/$/);
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't verified/i);
  });

  it("checks the session once after a sign-in return, not twice", async () => {
    vi.mocked(api.fetchSession).mockResolvedValue(connected());
    renderPage(<SessionBadge />, "/?channel=google");
    await screen.findByText("ann@example.com");
    expect(api.fetchSession).toHaveBeenCalledTimes(1);
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
