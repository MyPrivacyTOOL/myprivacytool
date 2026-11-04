// MPC-7502 step 4: tests for scripts/check-stripe-prices.mjs (node --test). No network: fetch is injected.
import test from "node:test";
import assert from "node:assert/strict";
import { comparePrice, loadPriceIds, run } from "./check-stripe-prices.mjs";

const PLANS = [
  { slug: "free", name: "Free", monthly_price_cents: 0, scans_label: "1", note: null, sort_order: 1 },
  { slug: "basic", name: "Basic", monthly_price_cents: 799, scans_label: "5", note: null, sort_order: 2 },
  { slug: "pro", name: "Pro", monthly_price_cents: 1499, scans_label: "25", note: null, sort_order: 3 },
];
const good = (id, cents) => ({ id, active: true, unit_amount: cents, currency: "usd", type: "recurring", recurring: { interval: "month", interval_count: 1 } });
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// A fake that serves plans (public columns), the service-role stripe_price_id read, and Stripe prices.
function fake({ prices = {}, tableIds = null, stripeStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("api.stripe.com/v1/prices/")) {
      const id = url.split("/").pop();
      return stripeStatus !== 200 ? json({}, stripeStatus) : json(prices[id]);
    }
    if (url.includes("select=slug,stripe_price_id")) return json(tableIds);
    if (url.includes("/rest/v1/plans")) return json(PLANS);
    throw new Error(`unexpected ${url}`);
  };
  return { f, calls };
}
const collect = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };

test("comparePrice accepts a matching monthly USD price", () => {
  assert.deepEqual(comparePrice(PLANS[1], good("price_a", 799)), []);
});

test("comparePrice reports amount, currency, interval and inactive problems", () => {
  assert.match(comparePrice(PLANS[1], good("price_a", 899)).join(), /charges 899 cents, plans table says 799/);
  assert.match(comparePrice(PLANS[1], { ...good("price_a", 799), currency: "eur" }).join(), /currency is eur/);
  assert.match(comparePrice(PLANS[1], { ...good("price_a", 799), recurring: { interval: "year", interval_count: 1 } }).join(), /not billed monthly/);
  assert.match(comparePrice(PLANS[1], { ...good("price_a", 799), type: "one_time", recurring: null }).join(), /not billed monthly/);
  assert.match(comparePrice(PLANS[1], { ...good("price_a", 799), active: false }).join(), /not active/);
  assert.match(comparePrice(PLANS[1], null).join(), /no price object/);
});

test("run skips with exit 0 when there is no Stripe key, and exits 2 with --require", async () => {
  const { f, calls } = fake(); const c = collect();
  assert.equal(await run({ env: {}, fetchImpl: f, log: c.log }), 0);
  assert.equal(calls.length, 0);
  assert.equal(await run({ env: {}, fetchImpl: f, argv: ["--require"], log: c.log }), 2);
});

test("run passes when the checkout variables point at matching prices, skipping the free plan", async () => {
  const { f, calls } = fake({ prices: { price_b: good("price_b", 799), price_p: good("price_p", 1499) } });
  const c = collect();
  const code = await run({ env: { STRIPE_SECRET_KEY: "rk_test_x", STRIPE_PRICE_BASIC: "price_b", STRIPE_PRICE_PRO: "price_p" }, fetchImpl: f, log: c.log });
  assert.equal(code, 0);
  const stripeCalls = calls.filter((x) => x.url.includes("api.stripe.com"));
  assert.equal(stripeCalls.length, 2);
  assert.ok(stripeCalls.every((x) => x.init.headers.Authorization === "Bearer rk_test_x"));
  assert.ok(!c.lines.join("\n").includes("rk_test_x"), "the key is never printed");
});

test("run exits 1 and names the plan when a Stripe amount drifted", async () => {
  const { f } = fake({ prices: { price_b: good("price_b", 799), price_p: good("price_p", 1999) } });
  const c = collect();
  assert.equal(await run({ env: { STRIPE_SECRET_KEY: "k", STRIPE_PRICE_BASIC: "price_b", STRIPE_PRICE_PRO: "price_p" }, fetchImpl: f, log: c.log }), 1);
  assert.match(c.lines.join("\n"), /pro: Stripe charges 1999 cents, plans table says 1499/);
});

test("a plan with no configured price id is reported but only fails with --require", async () => {
  const { f } = fake({ prices: { price_b: good("price_b", 799) } });
  const env = { STRIPE_SECRET_KEY: "k", STRIPE_PRICE_BASIC: "price_b" };
  assert.equal(await run({ env, fetchImpl: f, log: collect().log }), 0);
  assert.equal(await run({ env, fetchImpl: f, argv: ["--require"], log: collect().log }), 1);
});

test("a Stripe error makes the check fail with exit 2 instead of passing silently", async () => {
  const { f } = fake({ stripeStatus: 401 });
  assert.equal(await run({ env: { STRIPE_SECRET_KEY: "k", STRIPE_PRICE_BASIC: "price_b", STRIPE_PRICE_PRO: "price_p" }, fetchImpl: f, log: collect().log }), 2);
});

test("a malformed price id is a problem and never sent to Stripe", async () => {
  const { f, calls } = fake({ prices: { price_p: good("price_p", 1499) } });
  const c = collect();
  const code = await run({ env: { STRIPE_SECRET_KEY: "k", STRIPE_PRICE_BASIC: "../customers", STRIPE_PRICE_PRO: "price_p" }, fetchImpl: f, log: c.log });
  assert.equal(code, 1);
  assert.ok(!calls.some((x) => x.url.includes("customers")));
});

test("price ids in the plans table win over the checkout variables when the service key is set", async () => {
  const { f, calls } = fake({ tableIds: [{ slug: "basic", stripe_price_id: "price_table" }] });
  const ids = await loadPriceIds(PLANS.slice(1), { SUPABASE_SERVICE_ROLE_KEY: "svc", STRIPE_PRICE_BASIC: "price_env", STRIPE_PRICE_PRO: "price_p" }, f);
  assert.deepEqual(ids, { basic: "price_table", pro: "price_p" });
  assert.equal(calls[0].init.headers.apikey, "svc");
});
