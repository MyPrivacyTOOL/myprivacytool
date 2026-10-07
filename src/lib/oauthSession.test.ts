import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OAUTH_START_URL,
  OAUTH_URL,
  clearSessionHint,
  fetchSession,
  hasSessionHint,
  friendlySignInError,
  parseSignInReturn,
  stripSignInParams,
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

  describe("parseSignInReturn", () => {
    it("recognises the success redirect", () => {
      expect(parseSignInReturn("?channel=google")).toEqual({ kind: "success" });
      expect(parseSignInReturn("?utm_source=x&channel=google")).toEqual({ kind: "success" });
    });

    it("recognises a failed sign-in and gives a safe message, never the raw code", () => {
      const r = parseSignInReturn("?channel=google&oauth_error=access_denied");
      expect(r).toEqual({ kind: "error", message: expect.stringMatching(/cancelled/i) });
      const unknown = parseSignInReturn("?channel=google&oauth_error=%3Cscript%3E");
      expect(unknown?.kind).toBe("error");
      expect(JSON.stringify(unknown)).not.toMatch(/script/);
    });

    it("ignores anything that is not the Worker's redirect", () => {
      expect(parseSignInReturn("")).toBeNull();
      expect(parseSignInReturn("?channel=github")).toBeNull();
      expect(parseSignInReturn("?oauth_error=access_denied")).toBeNull();
    });
  });

  describe("stripSignInParams", () => {
    it("removes the sign-in markers and keeps everything else", () => {
      expect(stripSignInParams("?channel=google")).toBe("");
      expect(stripSignInParams("?channel=google&oauth_error=access_denied")).toBe("");
      expect(stripSignInParams("?utm_source=x&channel=google&a=1")).toBe("?utm_source=x&a=1");
      expect(stripSignInParams("")).toBe("");
    });
  });

  describe("friendlySignInError", () => {
    it("has specific copy for the cases a user can act on, and a generic fallback", () => {
      expect(friendlySignInError("access_denied")).toMatch(/cancelled/i);
      expect(friendlySignInError("email_not_verified")).toMatch(/isn't verified/i);
      expect(friendlySignInError("insufficient_provider_scope")).toMatch(/email address/i);
      expect(friendlySignInError("aud_mismatch")).toBe(friendlySignInError("whatever"));
      expect(friendlySignInError("connect_failed")).toMatch(/couldn't finish/i);
    });
  });
});
