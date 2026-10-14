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

  it("does NOT refresh when the token store cannot be read (the refresh token would be burned), and uses the static token", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      calls.push(String(u));
      if (String(u).startsWith("https://sb.test")) return new Response("relation does not exist", { status: 404 });
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 });
    });
    expect(await getUserAccessToken(base, log)).toBe("static");
    expect(calls.some((c) => c.includes("api.x.com"))).toBe(false);
  });

  it("does not refresh when Supabase is not configured at all", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    expect(await getUserAccessToken({ X_CLIENT_ID: "c", X_CLIENT_SECRET: "s", X_REFRESH_TOKEN: "r", X_USER_ACCESS_TOKEN: "static" }, log)).toBe("static");
    expect(f).not.toHaveBeenCalled();
  });

  it("retries saving the new pair once, and still returns the new token if saving fails", async () => {
    let writes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init?: RequestInit) => {
      const url = String(u);
      if (url.startsWith("https://sb.test") && init?.method === "POST") { writes++; return new Response("no", { status: 500 }); }
      if (url.startsWith("https://sb.test")) return Response.json([]);
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 });
    });
    expect(await getUserAccessToken(base, log)).toBe("new-access");
    expect(writes).toBe(2);
  });

  it("never logs token values", async () => {
    world(null);
    await getUserAccessToken(base, log);
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls])).not.toMatch(/new-access|new-refresh|boot-refresh|csec/);
  });

  it("falls back to the X_REFRESH_TOKEN secret when X refuses the stored refresh token (the owner generated a new token)", async () => {
    const bodies: string[] = [];
    let stored: any = { access_token: "old", refresh_token: "revoked-refresh", expires_at: hours(-1) };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init?: RequestInit) => {
      const url = String(u);
      if (url.startsWith("https://sb.test") && (!init || !init.method || init.method === "GET")) return Response.json([stored]);
      if (url.startsWith("https://sb.test")) { stored = JSON.parse(init!.body as string); return new Response(null, { status: 201 }); }
      bodies.push(String(init!.body));
      return String(init!.body).includes("refresh_token=boot-refresh")
        ? Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 })
        : new Response("revoked", { status: 400 });
    });
    expect(await getUserAccessToken(base, log)).toBe("new-access");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("refresh_token=revoked-refresh");
    expect(bodies[1]).toContain("refresh_token=boot-refresh");
    expect(stored.refresh_token).toBe("new-refresh");
  });

  it("does not retry with the bootstrap secret when it is the same token or a deploy placeholder", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init?: RequestInit) => {
      const url = String(u);
      if (url.startsWith("https://sb.test")) return Response.json([{ access_token: "old", refresh_token: "same", expires_at: hours(-1) }]);
      n++;
      return new Response("no", { status: 400 });
    });
    await getUserAccessToken({ ...base, X_REFRESH_TOKEN: "same" }, log);
    expect(n).toBe(1);
    resetTokenCache();
    await getUserAccessToken({ ...base, X_REFRESH_TOKEN: "placeholder" }, log);
    expect(n).toBe(2);
  });
});
