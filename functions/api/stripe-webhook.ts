// Cloudflare Pages Function: POST /api/stripe-webhook  (MPC-7626 follow-up)
// Verifies Stripe's signature (HMAC-SHA256 over "<t>.<raw body>", 5 minute tolerance) and acknowledges the event.
// It does NOT grant anything yet: there is no account or entitlement table to write to, so wiring paid access is a separate task.
// Needs STRIPE_WEBHOOK_SECRET; without it every call is rejected.

export interface WebhookEnv {
  STRIPE_WEBHOOK_SECRET?: string;
}

interface Ctx {
  request: Request;
  env: WebhookEnv;
}

const TOLERANCE_SECONDS = 300;

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || !secret) return false;
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") t = v ?? "";
    else if (k === "v1" && v) sigs.push(v);
  }
  const ts = Number(t);
  if (!Number.isFinite(ts) || ts <= 0 || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return sigs.some((s) => timingSafeEqual(s, expected));
}

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const body = await request.text();
  const ok = await verifyStripeSignature(body, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET ?? "");
  if (!ok) return new Response("invalid signature", { status: 400 });
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};
