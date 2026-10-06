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
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach/i);
    expect(screen.queryByRole("link", { name: /connect github/i })).toBeNull();
  });
});
