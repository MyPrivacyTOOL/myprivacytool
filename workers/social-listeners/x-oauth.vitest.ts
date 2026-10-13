// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserAccessToken, resetTokenCache } from "./src/x-oauth";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const base = { SUPABASE_URL: "https://sb.test", SUPABASE_KEY: "svc", X_CLIENT_ID: "cid", X_CLIENT_SECRET: "csec", X_REFRESH_TOKEN: "boot-refresh", X_USER_ACCESS_TOKEN: "static" };
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** A fake Supabase row store plus a fake X token endpoint. */
function world(row: null | { access_token: string; refresh_token: string; expires_at: string }, xStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let stored = row;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, init });
    if (url.startsWith("https://sb.test") && (!init || !init.method || init.method === "GET")) return Response.json(stored ? [stored] : []);
    if (url.startsWith("https://sb.test")) {
      const b = JSON.parse(init!.body as string);
      stored = { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at };
      return new Response(null, { status: 201 });
    }
    if (url === "https://api.x.com/2/oauth2/token")
      return xStatus === 200
        ? Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 })
        : new Response("no", { status: xStatus });
    throw new Error("unexpected " + url);
  });
  return { calls, get stored() { return stored; } };
}

beforeEach(() => resetTokenCache());
afterEach(() => vi.restoreAllMocks());

describe("getUserAccessToken", () => {
  it("uses the stored token while it is valid and does not call X", async () => {
    const w = world({ access_token: "stored-access", refresh_token: "r", expires_at: hours(1) });
    expect(await getUserAccessToken(base, log)).toBe("stored-access");
    expect(w.calls.some((c) => c.url.includes("api.x.com"))).toBe(false);
  });

  it("keeps the token in memory for later calls in the same isolate", async () => {
    const w = world({ access_token: "stored-access", refresh_token: "r", expires_at: hours(1) });
    await getUserAccessToken(base, log);
    await getUserAccessToken(base, log);
    expect(w.calls.filter((c) => c.url.startsWith("https://sb.test"))).toHaveLength(1);
  });

  it("bootstraps from X_REFRESH_TOKEN when nothing is stored, then stores the rotated pair", async () => {
    const w = world(null);
    expect(await getUserAccessToken(base, log)).toBe("new-access");
    const x = w.calls.find((c) => c.url.includes("api.x.com"))!;
    expect(String(x.init!.body)).toContain("refresh_token=boot-refresh");
    expect((x.init!.headers as Record<string, string>).Authorization).toBe("Basic " + btoa("cid:csec"));
    expect(w.stored).toMatchObject({ access_token: "new-access", refresh_token: "new-refresh" });
  });

  it("refreshes with the STORED refresh token once the stored access token has expired", async () => {
    const w = world({ access_token: "old", refresh_token: "stored-refresh", expires_at: hours(-1) });
    expect(await getUserAccessToken(base, log)).toBe("new-access");
    expect(String(w.calls.find((c) => c.url.includes("api.x.com"))!.init!.body)).toContain("refresh_token=stored-refresh");
  });

  it("refreshes a token that is about to expire (inside the safety margin)", async () => {
    world({ access_token: "old", refresh_token: "r", expires_at: new Date(Date.now() + 30_000).toISOString() });
    expect(await getUserAccessToken(base, log)).toBe("new-access");
  });

  it("force skips the cached and stored copies", async () => {
    world({ access_token: "still-valid", refresh_token: "r", expires_at: hours(1) });
    expect(await getUserAccessToken(base, log)).toBe("still-valid");
    expect(await getUserAccessToken(base, log, true)).toBe("new-access");
  });

  it("falls back to the static token when X refuses the refresh", async () => {
    world(null, 400);
    expect(await getUserAccessToken(base, log)).toBe("static");
  });

  it("uses the static token when refresh is not configured, and returns null when there is none", async () => {
    world(null);
    expect(await getUserAccessToken({ X_USER_ACCESS_TOKEN: "static" }, log)).toBe("static");
    expect(await getUserAccessToken({}, log)).toBeNull();
  });

  it("never logs token values", async () => {
    world(null);
    await getUserAccessToken(base, log);
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls])).not.toMatch(/new-access|new-refresh|boot-refresh|csec/);
  });
});
