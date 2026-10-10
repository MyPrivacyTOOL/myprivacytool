#!/usr/bin/env node
// CK-7318 / MPC-7260: the production gates from DEPLOYMENT_RUNBOOK.md section 3 (3a health + auth, 3b live Qwen)
// as one on-demand check, so nobody has to hand a secret to a person or an agent to run them.
//   WEBHOOK_SECRET=... node scripts/ci/core-brain-gates.mjs [--base-url URL]
// The secret comes from the environment only and is never printed. Output is limited to status codes and the
// non-sensitive fields `intent` and `intent_source`; response bodies are never echoed.
// The test message is a fixed synthetic string with no personal data.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = "https://brain.myprivacytool.io";
export const TEST_MESSAGE = { platform: "telegram", sender_id: "gate-test", message_text: "I want to scan my email for data leaks" };

const check = (name, ok, detail = "") => ({ name, ok: Boolean(ok), detail });

export async function gates(base, secret, f = fetch) {
  const results = [];
  const health = await f(`${base}/health`);
  const hb = await health.json().catch(() => ({}));
  results.push(check("3a /health -> configured:true", health.status === 200 && hb.ok === true && hb.configured === true, `status ${health.status}`));

  const anon = await f(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  results.push(check("3a POST /webhook without the secret -> 401", anon.status === 401, `status ${anon.status}`));

  if (!secret || !secret.trim()) {
    results.push(check("3b live Qwen gate", false, "WEBHOOK_SECRET is not set in the environment"));
    return results;
  }
  const res = await f(`${base}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MPT-Webhook-Secret": secret },
    body: JSON.stringify(TEST_MESSAGE),
  });
  const body = await res.json().catch(() => ({}));
  const source = typeof body.intent_source === "string" ? body.intent_source : "none";
  const intent = typeof body.intent === "string" ? body.intent : "none";
  results.push(check("3b authenticated POST /webhook -> 200", res.status === 200, `status ${res.status}`));
  results.push(check('3b live Qwen gate: intent_source is "qwen"', source === "qwen", `intent_source "${source}", intent "${intent}" ("rules" means Qwen was not reached: check QWEN_API_KEY and the DashScope account)`));
  return results;
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") opts.baseUrl = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { baseUrl } = parseArgs(process.argv.slice(2));
    const results = await gates((baseUrl || BASE).replace(/\/$/, ""), process.env.WEBHOOK_SECRET);
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : ` (${r.detail})`}`);
    const failed = results.filter((r) => !r.ok);
    for (const r of failed) console.log(`::error::core-brain gate failed: ${r.name} - ${r.detail}`);
    if (failed.length) process.exit(1);
    console.log("OK: all core-brain production gates passed");
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
