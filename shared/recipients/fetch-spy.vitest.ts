// @vitest-environment node
// MPC-9884 layer 3: the Worker fetch spy. Proves it passes a registered call, and fails on an unregistered host, a switched-off recipient, and a relative URL.
import { describe, expect, it } from "vitest";
import { createFetchSpy } from "./fetch-spy";

describe("createFetchSpy", () => {
  it("passes when every call hits a registered, enabled host", async () => {
    const spy = createFetchSpy();
    await spy.fetch("https://api.resend.com/emails", { method: "POST" });
    await spy.fetch("https://abcd.supabase.co/rest/v1/leads");
    expect(spy.calls[0].recipient).toBe("resend");
    expect(spy.calls[1].recipient).not.toBeNull(); // several entries share *.supabase.co; the first match is reported
    expect(() => spy.assertAllRegistered()).not.toThrow();
  });
  it("fails on a host that is not in the registry", async () => {
    const spy = createFetchSpy();
    await spy.fetch("https://tracker.evil.example.net/p");
    expect(() => spy.assertAllRegistered()).toThrow(/tracker\.evil\.example\.net.*not in the recipient registry/);
  });
  it("fails on a known host whose recipient is enabled:false", async () => {
    const spy = createFetchSpy();
    await spy.fetch("https://api.pwnedpasswords.com/range/ABCDE");
    expect(() => spy.assertAllRegistered()).toThrow(/pwned-passwords.*enabled:false/);
  });
  it("fails on a relative or malformed URL (host cannot be proven)", async () => {
    const spy = createFetchSpy();
    await spy.fetch("/api/whatever");
    expect(() => spy.assertAllRegistered()).toThrow(/not in the recipient registry/);
  });
  it("ignores a stub origin the test itself serves", async () => {
    const spy = createFetchSpy({ ignoreHosts: ["stub.test"] });
    await spy.fetch("https://stub.test/x");
    expect(() => spy.assertAllRegistered()).not.toThrow();
  });
  it("answers from respond() and never touches the network", async () => {
    const spy = createFetchSpy({ respond: () => new Response("pong", { status: 202 }) });
    const res = await spy.fetch("https://api.hunter.io/v2/email-verifier");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("pong");
  });
});
