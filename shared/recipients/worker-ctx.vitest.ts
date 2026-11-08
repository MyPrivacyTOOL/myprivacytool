// MPC-9885: recipientFetcher, the consent-gate switch and the scan_recipient_log sink.
import { describe, expect, it, vi } from "vitest";
import { callRecipient, recipientFetcher, RecipientError, setBundledRegistryForTests, type RecipientRegistry } from "./outbound";
import { CONSENT_GATE_ACTIVE, createRecipientLogSink, workerRecipientContext } from "./worker-ctx";
import data from "./recipients.json";

const registry = data as unknown as RecipientRegistry;
const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const codeOf = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return e instanceof RecipientError ? e.code : `other: ${e}`; } };

describe("consent gate switch", () => {
  it("is a constant that is off until MPC-9887, and Workers get the pending policy", () => {
    expect(CONSENT_GATE_ACTIVE).toBe(false);
    expect(workerRecipientContext({}).consentGate).toBe("pending_mpc_9887");
  });
  it("skips check 4 only when the policy says so; a post_click call without a consent id is still refused by default", async () => {
    const f = okFetch();
    expect(await codeOf(callRecipient("resend", { url: "https://api.resend.com/emails", sent: ["email"] }, { fetchImpl: f }))).toBe("CONSENT_REQUIRED");
    expect(f).not.toHaveBeenCalled();
    expect(await codeOf(callRecipient("resend", { url: "https://api.resend.com/emails", sent: ["email"] }, { fetchImpl: f, consentGate: "pending_mpc_9887" }))).toBe("no error");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("the pending policy skips ONLY check 4: host, items, disabled and flag checks still refuse", async () => {
    const ctx = workerRecipientContext({}, { fetchImpl: okFetch() });
    expect(await codeOf(callRecipient("resend", { url: "https://evil.example/emails", sent: ["email"] }, ctx))).toBe("HOST_MISMATCH");
    expect(await codeOf(callRecipient("resend", { url: "https://api.resend.com/emails", sent: ["password_hash_prefix"] }, ctx))).toBe("DATA_ITEM_NOT_ALLOWED");
    expect(await codeOf(callRecipient("hibp", { url: "https://haveibeenpwned.com/api/v3/x", sent: ["email"] }, ctx))).toBe("DISABLED");
    expect(await codeOf(callRecipient("hunter", { url: "https://api.hunter.io/v2/x", sent: ["email"] }, ctx))).toBe("FLAG_OFF");
    expect(await codeOf(callRecipient("hunter", { url: "https://api.hunter.io/v2/x", sent: ["email"] }, workerRecipientContext({ HUNTER_API_KEY: "k" }, { fetchImpl: okFetch() })))).toBe("no error");
  });
});

describe("recipientFetcher", () => {
  it("is callRecipient with the key and items bound, and passes url and init through unchanged", async () => {
    const f = okFetch();
    const res = await recipientFetcher("resend", ["email"], workerRecipientContext({}, { fetchImpl: f }))("https://api.resend.com/emails", { method: "POST", body: "x" });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledWith("https://api.resend.com/emails", { method: "POST", body: "x" });
  });
  it("accepts a URL object and rejects a Request (it has no declared host)", async () => {
    const ctx = workerRecipientContext({}, { fetchImpl: okFetch() });
    expect(await codeOf(recipientFetcher("resend", ["email"], ctx)(new URL("https://api.resend.com/emails")))).toBe("no error");
    expect(await codeOf(recipientFetcher("resend", ["email"], ctx)(new Request("https://api.resend.com/emails")))).toBe("BAD_URL");
  });
});

describe("scan_recipient_log sink", () => {
  const env = { SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "svc" };
  it("writes nothing for a call outside a scan, and one batched INSERT of item NAMES for a scan", async () => {
    const f = okFetch();
    const noScan = workerRecipientContext(env, { fetchImpl: f });
    await recipientFetcher("resend", ["email"], noScan)("https://api.resend.com/emails");
    expect(await noScan.flush()).toBe(0);
    expect(f).toHaveBeenCalledTimes(1);

    const g = okFetch();
    const ctx = workerRecipientContext(env, { fetchImpl: g, scanId: "scan-1", now: undefined } as never);
    await recipientFetcher("resend", ["email"], ctx)("https://api.resend.com/emails?to=secret@example.com");
    await recipientFetcher("hunter", ["email"], ctx)("https://api.hunter.io/v2/x").catch(() => {});   // FLAG_OFF: logged as skipped_disabled
    expect(await ctx.flush()).toBe(2);
    expect(g).toHaveBeenCalledTimes(2); // resend + ONE log write
    const [url, init] = (g as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(url).toBe("https://abc.supabase.co/rest/v1/scan_recipient_log");
    const rows = JSON.parse(String(init.body));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ scan_id: "scan-1", recipient_key: "resend", items: ["email"], status: "ran", http_status: 200 });
    expect(rows[1]).toMatchObject({ recipient_key: "hunter", items: [], status: "skipped_disabled", code: "FLAG_OFF" });
    const text = String(init.body);
    expect(text).not.toContain("secret@example.com");   // never a value or a URL
    expect(text).not.toContain("api.resend.com");
  });
  it("a failing log write never throws and never changes the call", async () => {
    const f = vi.fn(async (u: string) => (String(u).includes("scan_recipient_log") ? Promise.reject(new Error("down")) : new Response("{}"))) as unknown as typeof fetch;
    const ctx = workerRecipientContext(env, { fetchImpl: f, scanId: "s" });
    const res = await recipientFetcher("resend", ["email"], ctx)("https://api.resend.com/emails");
    expect(res.status).toBe(200);
    expect(await ctx.flush()).toBe(0);
  });
  it("is a no-op without Supabase credentials, and bounds the buffer", async () => {
    const s = createRecipientLogSink({}, okFetch());
    s.log({ key: "resend", items: [], at: "t", status: "ran", scan_id: "s" });
    expect(await s.flush()).toBe(0);
    const s2 = createRecipientLogSink(env, okFetch());
    for (let i = 0; i < 500; i++) s2.log({ key: "resend", items: [], at: "t", status: "ran", scan_id: "s" });
    expect(s2.pending).toBe(200);
  });
});

describe("test seam", () => {
  it("setBundledRegistryForTests swaps the registry for the default context and restores it", async () => {
    const copy = JSON.parse(JSON.stringify(registry)) as RecipientRegistry;
    copy.recipients.find((r) => r.key === "hibp")!.enabled = true;
    const restore = setBundledRegistryForTests(copy);
    expect(await codeOf(callRecipient("hibp", { url: "https://haveibeenpwned.com/api/v3/x", sent: ["email"] }, { fetchImpl: okFetch(), consentGate: "pending_mpc_9887", flags: { HIBP_API_KEY: "k" } }))).toBe("no error");
    restore();
    expect(await codeOf(callRecipient("hibp", { url: "https://haveibeenpwned.com/api/v3/x", sent: ["email"] }, { fetchImpl: okFetch(), consentGate: "pending_mpc_9887" }))).toBe("DISABLED");
  });
});
