import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ConnectGitHub from "./ConnectGitHub";
import * as api from "@/lib/githubChannel";

vi.mock("@/lib/githubChannel", async () => {
  const actual = await vi.importActual<typeof import("@/lib/githubChannel")>("@/lib/githubChannel");
  return { ...actual, fetchGithubProfile: vi.fn(), disconnectGithub: vi.fn() };
});

const profile: api.PapitProfile = {
  version: "1.0",
  generated_at: "2026-10-06T09:58:30.738Z",
  source_channel: "github",
  cryptographic_receipt: "ab".repeat(32),
  core_identity: { career: { skills: ["TypeScript", "Go"], primary_role: "Backend Developer", public_projects_count: 7 } },
  behavioral: { interests: ["privacy"], activity_level: "high" },
  privacy_boundaries: { data_retention_days: 30, revocable: true },
};

const renderAt = (url = "/connect/github") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConnectGitHub />
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe("<ConnectGitHub />", () => {
  it("shows a Connect link to the Worker's login when not connected", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "disconnected" });
    renderAt();
    const link = await screen.findByRole("link", { name: /connect github/i });
    expect(link).toHaveAttribute("href", api.GITHUB_START_URL);
  });

  it("shows the sanitized profile and a Disconnect button when connected", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    renderAt();
    expect(await screen.findByText("TypeScript, Go")).toBeInTheDocument();
    expect(screen.getByText("Backend Developer")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disconnect github/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect github/i })).toBeNull();
  });

  it("MPC-9795: says when the profile is a sample, and why interests are empty; shows neither for a complete profile", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    const first = renderAt();
    await screen.findByText("TypeScript, Go");
    expect(screen.queryByTestId("profile-sampled")).toBeNull();
    first.unmount();
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile: { ...profile, behavioral: { interests: [], activity_level: "high" }, data_coverage: { repos_sampled: true, starred_sampled: false, events_capped: true, interests: "no_stars" } } });
    renderAt();
    expect(await screen.findByTestId("profile-sampled")).toHaveTextContent(/300 public repos/);
    expect(screen.getByText("You have not starred anything.")).toBeInTheDocument();
    expect(screen.getByText("Main languages")).toBeInTheDocument();
  });

  it("disconnect returns to the Connect state", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    vi.mocked(api.disconnectGithub).mockResolvedValue(true);
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: /disconnect github/i }));
    expect(await screen.findByRole("link", { name: /connect github/i })).toBeInTheDocument();
    expect(api.disconnectGithub).toHaveBeenCalledTimes(1);
  });

  it("keeps the profile and says so when disconnect fails", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    vi.mocked(api.disconnectGithub).mockResolvedValue(false);
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: /disconnect github/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't disconnect/i);
    expect(screen.getByText("TypeScript, Go")).toBeInTheDocument();
  });

  it("shows a friendly message for ?channel_error and never echoes the raw code", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "disconnected" });
    renderAt("/connect/github?channel=github&channel_error=connect_failed&stage=exchange");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't finish connecting/i));
    expect(document.body.textContent).not.toContain("connect_failed");
    expect(document.body.textContent).not.toContain("exchange");
  });

  it("shows a service error (not the Connect button) when the Worker is unreachable", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "error" });
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t reach the connection service/i);
    expect(screen.queryByRole("link", { name: /connect github/i })).toBeNull();
  });

  // MPC-9796 (UX-040/041/042): a session that ended, a revoked token, no connection and an outage each say what they are.
  it("a session that ended says the stored connection remains until disconnected, and offers Connect", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt();
    expect(await screen.findByTestId("session-ended")).toHaveTextContent(/we still hold that connection until you disconnect it/i);
    expect(screen.getByRole("link", { name: /connect github/i })).toBeInTheDocument();
  });

  // MPC-10825: a person whose session ended can remove the stored connection without connecting.
  it("a session that ended offers to remove the stored connection through the Worker's remove sign-in", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt();
    const link = await screen.findByTestId("remove-stored");
    expect(link).toHaveAttribute("href", api.GITHUB_REMOVE_URL);
    expect(api.GITHUB_REMOVE_URL).toMatch(/\/oauth\/github\/remove$/);
    expect(link).toHaveTextContent(/remove the stored connection/i);
  });

  it("after a removal it says the connection was removed and does not claim one is still held", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt("/connect/github?channel_removed=1");
    expect(await screen.findByTestId("removed")).toHaveTextContent(/stored GitHub connection was removed.*deleted the access token.*revoked our access at GitHub/i);
    expect(screen.queryByTestId("session-ended")).toBeNull();
    expect(screen.queryByTestId("remove-stored")).toBeNull();
  });

  it("a revoked token says GitHub no longer allows it and that our copy was deleted", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "reauthorize" });
    renderAt();
    expect(await screen.findByTestId("reauthorize")).toHaveTextContent(/revoked, or it expired.*deleted our copy of the access token/i);
  });

  it("no connection says so, without claiming anything about an earlier session", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "disconnected" });
    renderAt();
    expect(await screen.findByTestId("not-connected")).toHaveTextContent("No GitHub account is connected.");
    expect(screen.queryByTestId("session-ended")).toBeNull();
  });

  it("an outage says it does not change the connection", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "error" });
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/says nothing about your connection, which is unchanged/i);
  });

  it("when connected it says what is kept and for how long", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    renderAt();
    expect(await screen.findByTestId("what-we-keep")).toHaveTextContent(/encrypted access token until you disconnect.*24 hours.*7 days/i);
    // MPC-10825: the row says "until you disconnect", not the declared 30 days.
    expect(screen.getByTestId("kept-until")).toHaveTextContent(/until you disconnect/i);
    expect(document.body.textContent).not.toMatch(/30 days|not enforced|Declared validity/);
  });
});
