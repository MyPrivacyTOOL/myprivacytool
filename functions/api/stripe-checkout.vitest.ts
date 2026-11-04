import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutEnabled, isPaidPlan, onRequestPost } from "./stripe-checkout";
import { onRequestPost as webhookPost, verifyStripeSignature } from "./stripe-webhook";

const env = { CHECKOUT_ENABLED: "1", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_BASIC: "price_b", STRIPE_PRICE_PRO: "price_p", STRIPE_PRICE_EXECUTIVE: "price_e" };
const req = (body: unknown) => new Request("https://myprivacytool.com/api/stripe-checkout", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());

describe("stripe-checkout", () => {
  it("is off unless enabled", async () => {
    expect(checkoutEnabled({})).toBe(false);
    expect(checkoutEnabled({ CHECKOUT_ENABLED: "yes" })).toBe(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await onRequestPost({ request: req({ plan: "pro" }), env: { ...env, CHECKOUT_ENABLED: "" } });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects bad json, free and unknown plans", async () => {
    expect((await onRequestPost({ request: req("nope"), env })).status).toBe(400);
    expect((await onRequestPost({ request: req({ plan: "free" }), env })).status).toBe(400);
    expect(isPaidPlan("executive")).toBe(true);
  });

  it("503s when a price id is missing", async () => {
    const res = await onRequestPost({ request: req({ plan: "pro" }), env: { ...env, STRIPE_PRICE_PRO: undefined } });
    expect(res.status).toBe(503);
  });

  it("creates a session using the server-side price and our own return urls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await onRequestPost({ request: req({ plan: "pro", price: "price_evil" }), env });
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const sent = new URLSearchParams(init.body as URLSearchParams);
    expect(sent.get("line_items[0][price]")).toBe("price_p");
    expect(sent.get("success_url")).toBe("https://myprivacytool.com/thank-you?source=checkout&plan=pro");
    expect(sent.get("cancel_url")).toBe("https://myprivacytool.com/pricing");
  });

  it("502s when Stripe fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    expect((await onRequestPost({ request: req({ plan: "basic" }), env })).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect((await onRequestPost({ request: req({ plan: "basic" }), env })).status).toBe(502);
  });
});

async function sign(payload: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

describe("stripe-webhook", () => {
  const now = 1_800_000_000;
  it("accepts a valid signature and rejects tampering, staleness and missing secret", async () => {
    const header = await sign("{}", "whsec", now);
    expect(await verifyStripeSignature("{}", header, "whsec", now)).toBe(true);
    expect(await verifyStripeSignature("{ }", header, "whsec", now)).toBe(false);
    expect(await verifyStripeSignature("{}", header, "other", now)).toBe(false);
    expect(await verifyStripeSignature("{}", header, "whsec", now + 301)).toBe(false);
    expect(await verifyStripeSignature("{}", null, "whsec", now)).toBe(false);
    expect(await verifyStripeSignature("{}", header, "", now)).toBe(false);
  });

  it("handler returns 400 on a bad signature and 200 on a good one", async () => {
    const bad = new Request("https://x/api/stripe-webhook", { method: "POST", body: "{}", headers: { "Stripe-Signature": "t=1,v1=00" } });
    expect((await webhookPost({ request: bad, env: { STRIPE_WEBHOOK_SECRET: "whsec" } })).status).toBe(400);
    const t = Math.floor(Date.now() / 1000);
    const good = new Request("https://x/api/stripe-webhook", { method: "POST", body: "{}", headers: { "Stripe-Signature": await sign("{}", "whsec", t) } });
    expect((await webhookPost({ request: good, env: { STRIPE_WEBHOOK_SECRET: "whsec" } })).status).toBe(200);
  });
});
