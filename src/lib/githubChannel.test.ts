import { describe, it, expect, vi } from "vitest";
import {
  GITHUB_CHANNEL_URL,
  GITHUB_START_URL,
  disconnectGithub,
  fetchGithubProfile,
  friendlyChannelError,
} from "./githubChannel";

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("githubChannel client", () => {
  it("starts login with a plain link to the Worker's /oauth/github/start", () => {
    expect(GITHUB_START_URL).toBe(`${GITHUB_CHANNEL_URL}/oauth/github/start`);
  });

  it("returns the profile on 200 and sends the session cookie", async () => {
    const profile = { version: "1.0", source_channel: "github" };
    const fetchFn = vi.fn().mockResolvedValue(res(200, profile));
    const out = await fetchGithubProfile(fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ status: "connected", profile });
    expect(fetchFn).toHaveBeenCalledWith(`${GITHUB_CHANNEL_URL}/channels/github/profile`, { credentials: "include" });
  });

  it.each([401, 404])("treats %i (not connected / reauthorize) as disconnected", async (code) => {
    const fetchFn = vi.fn().mockResolvedValue(res(code, { error: "reauthorize" }));
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
    const unknown = friendlyChannelError("<script>alert(1)</script>");
    expect(unknown).toMatch(/couldn't finish/i);
    expect(unknown).not.toContain("script");
  });
});
