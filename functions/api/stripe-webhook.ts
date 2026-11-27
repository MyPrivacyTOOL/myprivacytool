// Cloudflare Pages Function: POST /api/stripe-webhook  (MPC-7626 follow-up)
// Verifies Stripe's signature (HMAC-SHA256 over "<t>.<raw body>", 5 minute tolerance) and acknowledges the event.
// It does NOT grant anything: paid access is a separate task.
// CK-11491: on checkout.session.completed it writes the Stripe customer id onto the scans made with the checkout's email address (public.scans.stripe_customer_id),
// so conversion can be counted. DORMANT until checkout opens: it needs the Pages variable SUPABASE_SERVICE_ROLE_KEY; without it the event is only acknowledged.
// A failed write answers 500, so Stripe sends the event again.
// Needs STRIPE_WEBHOOK_SECRET; without it every call is rejected.
import { callRecipient } from "../../shared/recipients/outbound.ts";
import { workerRecipientContext } from "../../shared/recipients/worker-ctx.ts";

export interface WebhookEnv {
  STRIPE_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const DEFAULT_SUPABASE_URL = "https://xmdmkumwxpgahmlweuug.supabase.co";

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

/** The email and customer id of a completed checkout, or null for any other event or a malformed one. */
export function checkoutCustomer(payload: string): { email: string; customerId: string } | null {
  try {
    const event = JSON.parse(payload) as { type?: unknown; data?: { object?: { customer?: unknown; customer_email?: unknown; customer_details?: { email?: unknown } } } };
    if (event.type !== "checkout.session.completed") return null;
    const session = event.data?.object;
    const email = session?.customer_details?.email ?? session?.customer_email;
    const customerId = session?.customer;
    if (typeof email !== "string" || !email.includes("@") || typeof customerId !== "string" || !/^cus_[A-Za-z0-9]{1,64}$/.test(customerId)) return null;
    return { email: email.trim().toLowerCase(), customerId };
  } catch {
    return null;
  }
}

/** "linked" (also when the address has no scan), "not_configured", or "failed". Never throws and never logs the address. */
export async function linkStripeCustomer(env: WebhookEnv, { email, customerId }: { email: string; customerId: string }): Promise<"linked" | "not_configured" | "failed"> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return "not_configured";
  try {
    const res = await callRecipient("supabase", {
      url: `${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/scans?email_scanned=eq.${encodeURIComponent(email)}&stripe_customer_id=is.null`,
      init: { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ stripe_customer_id: customerId }) },
      sent: ["email"],
    }, workerRecipientContext(env as Record<string, unknown>));
    return res.ok ? "linked" : "failed";
  } catch {
    return "failed";
  }
}

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const body = await request.text();
  const ok = await verifyStripeSignature(body, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET ?? "");
  if (!ok) return new Response("invalid signature", { status: 400 });
  const customer = checkoutCustomer(body);
  if (customer) {
    const outcome = await linkStripeCustomer(env, customer);
    if (outcome === "not_configured") console.warn("checkout completed but scans were not linked: SUPABASE_SERVICE_ROLE_KEY is not set on Pages");
    if (outcome === "failed") return new Response("link failed", { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};
