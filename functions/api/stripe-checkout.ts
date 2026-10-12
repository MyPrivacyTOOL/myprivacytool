// Cloudflare Pages Function: POST /api/stripe-checkout  { plan: "basic" | "pro" | "executive" }  ->  { url }  (MPC-7626 follow-up)
// Creates a Stripe Checkout Session (subscription mode) and returns its hosted URL. OFF unless the Pages variable
// CHECKOUT_ENABLED is 1/true/on/yes; until then it answers 503 and nothing is sent to Stripe. Needs STRIPE_SECRET_KEY and one
// price id per plan (STRIPE_PRICE_BASIC / _PRO / _EXECUTIVE). The browser never sends a price or amount, only the plan name.

export interface CheckoutEnv {
  CHECKOUT_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_BASIC?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_EXECUTIVE?: string;
}

interface Ctx {
  request: Request;
  env: CheckoutEnv;
}

export type PaidPlan = "basic" | "pro" | "executive";

const PRICE_VAR: Record<PaidPlan, keyof CheckoutEnv> = {
  basic: "STRIPE_PRICE_BASIC",
  pro: "STRIPE_PRICE_PRO",
  executive: "STRIPE_PRICE_EXECUTIVE",
};

export const checkoutEnabled = (env: CheckoutEnv): boolean => /^(1|true|on|yes)$/i.test((env.CHECKOUT_ENABLED ?? "").trim());

export const isPaidPlan = (v: unknown): v is PaidPlan => v === "basic" || v === "pro" || v === "executive";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  if (!checkoutEnabled(env)) return json({ error: "checkout_disabled" }, 503);

  let plan: unknown;
  try {
    plan = ((await request.json()) as { plan?: unknown }).plan;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!isPaidPlan(plan)) return json({ error: "unknown_plan" }, 400);

  const price = env[PRICE_VAR[plan]];
  if (!env.STRIPE_SECRET_KEY || !price) return json({ error: "checkout_not_configured" }, 503);

  // Return URLs are built from our own origin, never from the request body.
  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/thank-you?source=checkout&plan=${plan}`,
    cancel_url: `${origin}/pricing`,
    "metadata[plan]": plan,
    "subscription_data[metadata][plan]": plan,
  });

  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    return json({ error: "stripe_unreachable" }, 502);
  }
  if (!res.ok) return json({ error: "stripe_error" }, 502);

  const session = (await res.json()) as { url?: string };
  if (!session.url) return json({ error: "stripe_error" }, 502);
  return json({ url: session.url });
};
