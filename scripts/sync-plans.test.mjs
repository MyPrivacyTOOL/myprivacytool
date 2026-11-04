// MPC-7502: tests for scripts/sync-plans.mjs (node --test). No network: fetch is injected.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SNAPSHOT, fetchPlans, serialize, validatePlans } from "./sync-plans.mjs";

const row = (o) => ({ slug: "pro", name: "Pro", monthly_price_cents: 1499, scans_label: "25 scans per month", note: null, sort_order: 3, ...o });
const FREE = row({ slug: "free", name: "Free", monthly_price_cents: 0, sort_order: 1, note: "No credit card required" });
const reply = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

test("validatePlans orders by sort_order, drops sort_order and defaults note to null", () => {
  const out = validatePlans([row({ sort_order: 3 }), FREE, row({ slug: "basic", name: "Basic", monthly_price_cents: 799, sort_order: 2, note: undefined })]);
  assert.deepEqual(out.map((p) => p.slug), ["free", "basic", "pro"]);
  assert.ok(out.every((p) => !("sort_order" in p)) && out[1].note === null);
});

test("validatePlans refuses data it cannot trust", () => {
  assert.throws(() => validatePlans([]), /no plans/);
  assert.throws(() => validatePlans("x"), /no plans/);
  assert.throws(() => validatePlans([FREE, row({ monthly_price_cents: -1 })]), /bad price/);
  assert.throws(() => validatePlans([FREE, row({ monthly_price_cents: 14.99 })]), /bad price/);
  assert.throws(() => validatePlans([FREE, row({ slug: "Bad Slug" })]), /bad slug/);
  assert.throws(() => validatePlans([FREE, row({ slug: "free" })]), /duplicate/);
  assert.throws(() => validatePlans([row()]), /free plan/);
  assert.throws(() => validatePlans([{ ...FREE, monthly_price_cents: 100 }]), /free plan/);
  assert.throws(() => validatePlans([FREE, row({ scans_label: "" })]), /scans_label/);
});

test("fetchPlans asks for active rows with the public columns only, and never selects stripe_price_id", async () => {
  let seen;
  const out = await fetchPlans(async (url, init) => { seen = { url, init }; return reply([FREE, row()])(); }, {});
  assert.equal(out.length, 2);
  assert.match(seen.url, /\/rest\/v1\/plans\?select=slug,name,monthly_price_cents,scans_label,note,sort_order&active=eq\.true&order=sort_order$/);
  assert.ok(!seen.url.includes("stripe"));
  assert.ok(seen.init.headers.apikey && seen.init.headers.Authorization.startsWith("Bearer "));
});

test("fetchPlans fails on an HTTP error so the build keeps the committed snapshot", async () => {
  await assert.rejects(() => fetchPlans(reply({}, 503), {}), /503/);
});

test("the committed snapshot is valid and in serialize() form", () => {
  const text = readFileSync(SNAPSHOT, "utf8");
  const parsed = JSON.parse(text);
  const withOrder = parsed.map((p, i) => ({ ...p, sort_order: i + 1 }));
  assert.deepEqual(validatePlans(withOrder), parsed);
  assert.equal(serialize(parsed), text);
});
