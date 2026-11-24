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
  expires_at: "2026-11-05T09:58:30.738Z",
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
    expect(await screen.findByTestId("session-ended")).toHaveTextContent(/we may still hold that connection until you remove it/i);
    expect(screen.getByRole("link", { name: /connect github/i })).toBeInTheDocument();
  });

  // MPC-10825: a way to remove the stored connection when there is no session.
  it("a session that ended offers to remove the stored connection through the Worker's sign-in, without a Disconnect button", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt();
    const remove = await screen.findByRole("link", { name: /remove my stored connection/i });
    expect(remove).toHaveAttribute("href", api.GITHUB_REMOVE_URL);
    expect(screen.getByTestId("session-ended")).toHaveTextContent(/sign in with github.*delete the stored token.*revoke our access/i);
    expect(screen.queryByRole("button", { name: /disconnect github/i })).toBeNull();
  });

  it("offers Remove only where something may be stored: not when disconnected, signed in, revoked or in an outage", async () => {
    for (const status of ["disconnected", "reauthorize", "error"] as const) {
      vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status });
      const view = renderAt();
      await waitFor(() => expect(screen.queryByText(/checking your connection/i)).toBeNull());
      expect(screen.queryByRole("link", { name: /remove my stored connection/i })).toBeNull();
      view.unmount();
    }
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    renderAt();
    await screen.findByText("TypeScript, Go");
    expect(screen.queryByRole("link", { name: /remove my stored connection/i })).toBeNull();
  });

  it("after a removal it says what was removed, shows no stale 'session ended' note, and offers Connect", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt("/connect/github?channel_removed=github&revoked=1");
    const note = await screen.findByTestId("removed");
    expect(note).toHaveTextContent(/stored GitHub connection was removed.*deleted the encrypted access token.*revoked our access at GitHub/i);
    expect(await screen.findByTestId("not-connected")).toHaveTextContent("No GitHub account is connected.");
    expect(screen.queryByTestId("session-ended")).toBeNull();
    expect(screen.queryByRole("link", { name: /remove my stored connection/i })).toBeNull();
    expect(screen.getByRole("link", { name: /connect github/i })).toHaveAttribute("href", api.GITHUB_START_URL);
  });

  it("a removal whose GitHub revoke could not be confirmed says so and points to GitHub Settings", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt("/connect/github?channel_removed=github&revoked=0");
    const note = await screen.findByTestId("removed");
    expect(note).toHaveTextContent(/could not confirm the revoke at GitHub.*GitHub Settings, Applications/i);
    expect(note).not.toHaveTextContent(/we also revoked our access/i);
  });

  it("a cancelled or failed removal shows its own message and keeps the Remove link, never claiming removal", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "session_ended" });
    renderAt("/connect/github?channel_error=remove_failed&stage=delete");
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't remove the stored connection/i);
    expect(screen.queryByTestId("removed")).toBeNull();
    expect(screen.getByRole("link", { name: /remove my stored connection/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("remove_failed");
  });

  // MPC-10825: the "30 days" snapshot label said how long a recipient may keep a copy; it was read as how long WE keep your connection.
  it("says the connection is kept until you disconnect, and no longer shows '30 days'", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    renderAt();
    expect(await screen.findByText("Connection kept")).toBeInTheDocument();
    expect(screen.getByText("Until you disconnect")).toBeInTheDocument();
    expect(screen.queryByText(/declared validity/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/30 days/);
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
  });

  // MPC-10833: the profile shows the date it stops being valid, and a token past 90 days asks to connect again.
  it("shows the date the profile is valid until, not a 'not enforced' note", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile });
    renderAt();
    expect(await screen.findByTestId("valid-until")).toHaveTextContent("2026-11-05");
    // MPC-10833: only our own verify check refuses an expired copy; the page must not claim anyone holding a copy is forced to.
    expect(screen.getByText(/our verify check refuses a copy after that date/)).toBeInTheDocument();
    expect(screen.queryByText(/a copy of this profile is refused/)).toBeNull();
    expect(screen.queryByText(/not enforced/i)).toBeNull();
  });

  it("an older profile without expires_at falls back to the 30-day period in words", async () => {
    const { expires_at: _drop, ...older } = profile;
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "connected", profile: older });
    renderAt();
    expect(await screen.findByTestId("valid-until")).toHaveTextContent("30 days after it was made");
  });

  it("a connection older than 90 days says we stopped using the token and offers Connect", async () => {
    vi.mocked(api.fetchGithubProfile).mockResolvedValue({ status: "reconsent" });
    renderAt();
    expect(await screen.findByTestId("reconsent")).toHaveTextContent(/more than 90 days ago.*stopped using the stored access token/i);
    expect(screen.getByRole("link", { name: /connect github/i })).toHaveAttribute("href", api.GITHUB_START_URL);
  });
});
