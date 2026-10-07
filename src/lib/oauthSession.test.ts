import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OAUTH_START_URL,
  OAUTH_URL,
  clearSessionHint,
  fetchSession,
  hasSessionHint,
  isSignInReturn,
  setSessionHint,
  signOut,
} from "./oauthSession";

const res = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("oauthSession client", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("targets the Worker's session-mode sign-in", () => {
    expect(OAUTH_START_URL).toBe(`${OAUTH_URL}/oauth/google/start?mode=session`);
  });

  describe("fetchSession", () => {
    it("returns the email and expiry for an authenticated session, sending cookies", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        res(200, { authenticated: true, user: { email: "a@b.co" }, expires_at: "2026-10-07T07:00:00.000Z" }),
      );
      const r = await fetchSession(fetchFn as unknown as typeof fetch);
      expect(r).toEqual({ status: "connected", email: "a@b.co", expiresAt: Date.parse("2026-10-07T07:00:00.000Z") });
      expect(fetchFn).toHaveBeenCalledWith(`${OAUTH_URL}/v1/session`, { credentials: "include" });
    });

    it("treats 401 as disconnected", async () => {
      expect(await fetchSession(vi.fn().mockResolvedValue(res(401, { authenticated: false })) as unknown as typeof fetch))
        .toEqual({ status: "disconnected" });
    });

    it("treats an unauthenticated 200 or a missing email as disconnected", async () => {
      expect(await fetchSession(vi.fn().mockResolvedValue(res(200, { authenticated: false })) as unknown as typeof fetch))
        .toEqual({ status: "disconnected" });
      expect(await fetchSession(vi.fn().mockResolvedValue(res(200, { authenticated: true, user: {} })) as unknown as typeof fetch))
        .toEqual({ status: "disconnected" });
    });

    it("keeps expiresAt null when the date is missing or invalid", async () => {
      const r = await fetchSession(
        vi.fn().mockResolvedValue(res(200, { authenticated: true, user: { email: "a@b.co" }, expires_at: "nope" })) as unknown as typeof fetch,
      );
      expect(r).toEqual({ status: "connected", email: "a@b.co", expiresAt: null });
    });

    it("reports an error for server failures and network failures, never throwing", async () => {
      expect(await fetchSession(vi.fn().mockResolvedValue(res(502)) as unknown as typeof fetch)).toEqual({ status: "error" });
      expect(await fetchSession(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch))
        .toEqual({ status: "error" });
    });
  });

  describe("signOut", () => {
    it("sends DELETE with cookies and reports success", async () => {
      const fetchFn = vi.fn().mockResolvedValue(res(200, { ok: true }));
      expect(await signOut(fetchFn as unknown as typeof fetch)).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(`${OAUTH_URL}/v1/session`, { method: "DELETE", credentials: "include" });
    });

    it("reports failure for a rejected origin or a network error", async () => {
      expect(await signOut(vi.fn().mockResolvedValue(res(403, { error: "forbidden_origin" })) as unknown as typeof fetch)).toBe(false);
      expect(await signOut(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch)).toBe(false);
    });
  });

  describe("sign-in hint", () => {
    it("round-trips through localStorage", () => {
      expect(hasSessionHint()).toBe(false);
      setSessionHint();
      expect(hasSessionHint()).toBe(true);
      clearSessionHint();
      expect(hasSessionHint()).toBe(false);
    });

    it("does not throw when storage is unavailable", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(hasSessionHint()).toBe(false);
      expect(() => setSessionHint()).not.toThrow();
      expect(() => clearSessionHint()).not.toThrow();
    });
  });

  describe("isSignInReturn", () => {
    it("is true only for the success redirect", () => {
      expect(isSignInReturn("?channel=google")).toBe(true);
      expect(isSignInReturn("?channel=google&oauth_error=aud_mismatch")).toBe(false);
      expect(isSignInReturn("?channel=github")).toBe(false);
      expect(isSignInReturn("")).toBe(false);
    });
  });
});
