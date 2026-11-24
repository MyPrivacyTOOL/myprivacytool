import { describe, it, expect, vi } from "vitest";
import {
  GITHUB_CHANNEL_URL,
  GITHUB_REMOVE_URL,
  GITHUB_START_URL,
  disconnectGithub,
  fetchGithubProfile,
  friendlyChannelError,
  removalNotice,
} from "./githubChannel";

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("githubChannel client", () => {
  it("starts login with a plain link to the Worker's /oauth/github/start", () => {
    expect(GITHUB_START_URL).toBe(`${GITHUB_CHANNEL_URL}/oauth/github/start`);
  });

  // MPC-10825: removing a stored connection without a session is a plain link to the Worker's /oauth/github/remove.
  it("removes a stored connection through a plain link to the Worker's /oauth/github/remove", () => {
    expect(GITHUB_REMOVE_URL).toBe(`${GITHUB_CHANNEL_URL}/oauth/github/remove`);
    expect(GITHUB_REMOVE_URL).not.toBe(GITHUB_START_URL);
  });

  it("reads the removal redirect: only channel_removed=github counts, and revoked must be exactly 1", () => {
    expect(removalNotice("github", "1")).toEqual({ revokedAtGithub: true });
    expect(removalNotice("github", "0")).toEqual({ revokedAtGithub: false });
    expect(removalNotice("github", null)).toEqual({ revokedAtGithub: false });
    expect(removalNotice(null, "1")).toBeNull();
    expect(removalNotice("reddit", "1")).toBeNull();
    expect(removalNotice("<script>", "1")).toBeNull();
  });

  it("returns the profile on 200 and sends the session cookie", async () => {
    const profile = { version: "1.0", source_channel: "github" };
    const fetchFn = vi.fn().mockResolvedValue(res(200, profile));
    const out = await fetchGithubProfile(fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ status: "connected", profile });
    expect(fetchFn).toHaveBeenCalledWith(`${GITHUB_CHANNEL_URL}/channels/github/profile`, { credentials: "include" });
  });

  // MPC-9796: each way of "not connected" is its own status.
  it("401 unauthenticated is a session that ended, not a disconnected account", async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(401, { error: "unauthenticated" }));
    expect(await fetchGithubProfile(fetchFn as unknown as typeof fetch)).toEqual({ status: "session_ended" });
  });

  it("401 reauthorize is a token GitHub no longer accepts", async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(401, { error: "reauthorize" }));
    expect(await fetchGithubProfile(fetchFn as unknown as typeof fetch)).toEqual({ status: "reauthorize" });
  });

  it("401 with no readable body is treated as a session that ended", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => { throw new Error("no body"); } });
    expect(await fetchGithubProfile(fetchFn as unknown as typeof fetch)).toEqual({ status: "session_ended" });
  });

  it("404 not_connected is disconnected", async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(404, { error: "not_connected" }));
    expect(await fetchGithubProfile(fetchFn as unknown as typeof fetch)).toEqual({ status: "disconnected" });
  });

  it("treats 502 and network failures as an error, not as disconnected", async () => {
    expect(await fetchGithubProfile(vi.fn().mockResolvedValue(res(502)) as unknown as typeof fetch)).toEqual({ status: "error" });
    expect(await fetchGithubProfile(vi.fn().mockRejectedValue(new TypeError("net")) as unknown as typeof fetch)).toEqual({ status: "error" });
  });

  it("disconnect sends DELETE with credentials and reports success/failure", async () => {
    const ok = vi.fn().mockResolvedValue(res(200, { ok: true }));
    expect(await disconnectGithub(ok as unknown as typeof fetch)).toBe(true);
    expect(ok).toHaveBeenCalledWith(`${GITHUB_CHANNEL_URL}/channels/github`, { method: "DELETE", credentials: "include" });
    expect(await disconnectGithub(vi.fn().mockResolvedValue(res(403)) as unknown as typeof fetch)).toBe(false);
    expect(await disconnectGithub(vi.fn().mockRejectedValue(new Error("x")) as unknown as typeof fetch)).toBe(false);
  });

  it("maps callback error codes to safe visitor copy and never echoes unknown input", () => {
    expect(friendlyChannelError(null)).toBeNull();
    expect(friendlyChannelError("access_denied")).toMatch(/cancelled/i);
    expect(friendlyChannelError("invalid_state")).toMatch(/expired/i);
    expect(friendlyChannelError("remove_access_denied")).toMatch(/cancelled.*nothing was removed/i);
    expect(friendlyChannelError("remove_failed")).toMatch(/couldn't remove the stored connection/i);
    const unknown = friendlyChannelError("<script>alert(1)</script>");
    expect(unknown).toMatch(/couldn't finish/i);
    expect(unknown).not.toContain("script");
  });
});
