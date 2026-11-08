// @vitest-environment node
// MPC-9885: every outbound call of this Worker goes through the recipient wrapper. The fetch spy answers all of them and fails the test if a call
// reaches a host that is not in shared/recipients/recipients.json (or a switched-off recipient); the assertions name WHICH recipient was reached.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchSpy } from "../../shared/recipients/fetch-spy";
import { runChecks, SITES } from "./src/deep-scan";
import { syncToHubSpot, resetHubSpotCache } from "./src/hubspot-sync";
import { sendXDm } from "./src/mirror-bot";
import { callCoreBrain } from "./src/shared";
import { replyCaptureErased } from "./src/telegram-capture";
import { uploadDmVideo } from "./src/x-media";
import { resetTokenCache } from "./src/x-oauth";
import worker from "./src/index";
import type { Env } from "./src/shared";

const quiet = { info() {}, warn() {}, error() {} };
// The spy names the first registry entry that owns a host (api.x.com is also listed under platform-replies), so the assertions are on hosts.
const keys = (spy: ReturnType<typeof createFetchSpy>) => [...new Set(spy.calls.map((c) => c.host))].sort();
const stub = (respond?: Parameters<typeof createFetchSpy>[0]["respond"]) => {
  const spy = createFetchSpy({ respond, ignoreHosts: ["api.x.com"] }); // api.x.com is shared with the disabled platform-replies entry; the wrapper itself checks it against x-api
  vi.stubGlobal("fetch", spy.fetch);
  return spy;
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetTokenCache(); resetHubSpotCache(); });

describe("social-listeners outbound calls reach registered recipients only", () => {
  it("deep check: every site in the fixed list is covered by deep-scan-sites, redirects stay manual", async () => {
    const spy = stub(() => new Response("{}", { status: 302 }));
    const seen: (RequestRedirect | undefined)[] = [];
    vi.stubGlobal("fetch", (async (u: RequestInfo | URL, init?: RequestInit) => { seen.push(init?.redirect); return spy.fetch(u, init); }) as typeof fetch);
    const results = await runChecks("some_user", SITES, {} as Env);
    expect(results.every((r) => r.evidence.reason === "redirect_refused")).toBe(true);
    expect(spy.calls).toHaveLength(SITES.length);
    expect(spy.calls.every((c) => SITES.some((s) => s.host === c.host))).toBe(true);
    expect(seen.every((r) => r === "manual")).toBe(true);
    spy.assertAllRegistered();
  });

  it("telegram erase reply goes to api.telegram.org", async () => {
    const spy = stub();
    await replyCaptureErased({ TELEGRAM_BOT_TOKEN: "1:T" } as unknown as Env, { message: { chat: { id: 5 } } }, true, quiet);
    expect(keys(spy)).toEqual(["api.telegram.org"]);
    spy.assertAllRegistered();
  });

  it("HubSpot sync reaches api.hubapi.com and the Supabase feed", async () => {
    const spy = stub((url) => new Response(JSON.stringify(url.includes("/search") ? { results: [] } : {}), { status: 200 }));
    await syncToHubSpot({ HUBSPOT_SOCIAL_TOKEN: "tok", SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" } as unknown as Env, { userId: "42", handle: "h", event: "dm" }, quiet);
    expect(keys(spy)).toEqual(["api.hubapi.com", "x.supabase.co"]);
    spy.assertAllRegistered();
  });

  it("an X DM with the clip reaches api.x.com, the Supabase token store and our own site (the clip)", async () => {
    const spy = stub((url) => {
      if (url.endsWith("alice-curtain-silent.mp4")) return new Response(new Uint8Array([1, 2, 3]));
      if (url.includes("mpt_x_oauth_tokens")) return Response.json([{ access_token: "a", refresh_token: "r", expires_at: new Date(Date.now() + 3_600_000).toISOString() }]);
      if (url.includes("/initialize")) return Response.json({ data: { id: "m1" } });
      if (url.includes("/finalize")) return Response.json({ data: {} });
      return Response.json({ data: {} });
    });
    const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" } as unknown as Env;
    expect(await sendXDm(env, "42", "hello", quiet, { video: true })).toBe(true);
    expect(keys(spy)).toEqual(["api.x.com", "myprivacytool.io", "x.supabase.co"]);
    spy.assertAllRegistered();
  });

  it("OAuth 1.0a media upload and the token refresh run on x-api without X_BEARER_TOKEN", async () => {
    const spy = stub((url) => (url.includes("/initialize") ? Response.json({ data: { id: "m1" } }) : Response.json({ data: {} })));
    const env = { X_CONSUMER_KEY: "ck", X_CONSUMER_SECRET: "cs", X_ACCESS_TOKEN: "at", X_ACCESS_TOKEN_SECRET: "as" } as unknown as Env;
    await uploadDmVideo(env, quiet, async () => null);
    expect(spy.calls.some((c) => c.host === "api.x.com")).toBe(true);
    spy.assertAllRegistered();
  });

  it("core-brain over its public workers.dev address is internal-workers; the service binding is not a recipient", async () => {
    const spy = stub();
    const env = { CORE_BRAIN_URL: "https://core-brain.myprivacytool.workers.dev", CORE_BRAIN_TOKEN: "t" } as unknown as Env;
    const res = await callCoreBrain(env, { source: "telegram", receivedAt: "now", payload: {} }, quiet);
    expect(res).not.toBeNull();
    expect(spy.calls[0].host).toBe("core-brain.myprivacytool.workers.dev");
    expect(spy.calls[0].recipient).toBe("internal-workers");
    expect(spy.calls[0].method).toBe("POST");
    const binding = vi.fn(async () => Response.json({}));
    spy.calls.length = 0;
    await callCoreBrain({ CORE_BRAIN: { fetch: binding } } as unknown as Env, { source: "telegram", receivedAt: "now", payload: {} }, quiet);
    expect(binding).toHaveBeenCalledTimes(1);
    expect(spy.calls).toHaveLength(0);
  });

  it("the webhook entry point sends nothing to an unregistered host", async () => {
    const spy = stub();
    const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: "1:T", CORE_BRAIN: { fetch: async () => Response.json({ ignored: true }) } } as unknown as Env;
    const req = new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: 1, message: { text: "hi", from: { id: 7, is_bot: false }, chat: { id: 7, type: "private" } } }) });
    expect((await worker.fetch(req, env)).status).toBe(200);
    spy.assertAllRegistered();
  });
});
