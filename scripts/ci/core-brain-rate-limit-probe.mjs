#!/usr/bin/env node
// MPC-7257: live check of the core-brain rate limit (10 requests / 60s per sender -> the 11th gets 429).
//   WEBHOOK_SECRET=... node scripts/ci/core-brain-rate-limit-probe.mjs [--base-url URL] [--count 30]
// Sends `count` (default 30; only about 11 reach Qwen, the 429s are cheap) authenticated POSTs for ONE synthetic sender, in order, then one more for a different synthetic sender.
// The first 10 are real requests (each makes a live Qwen call), so run it on demand only (workflow: Core Brain rate-limit probe).
// The secret comes from the environment only and is never printed. Output is limited to status codes, the 429 error code and
// Retry-After; response bodies are never echoed. Senders are fresh per run (rl-probe-<time>), so a re-run never meets old counters.
// The limiter keeps counters per Cloudflare location, so the cut-off is approximate; from one runner it is normally exactly 11.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = "https://brain.myprivacytool.io";
export const LIMIT = 10;
// The Workers Rate Limiting binding is approximate (per Cloudflare location, documented as permissive), so the first 429 may
// arrive a request or two late. Live run 38118515365: first 429 at request 12. Accept 11 to LIMIT + SLACK, never earlier.
export const SLACK = 4;
const MESSAGE = "I want to scan my email for data leaks";

const check = (name, ok, detail = "") => ({ name, ok: Boolean(ok), detail });

export async function probe(base, secret, { count = 30, f = fetch, now = () => Date.now() } = {}) {
  if (!secret || !secret.trim()) return [check("rate limit probe", false, "WEBHOOK_SECRET is not set in the environment")];
  const stamp = now();
  const results = [];
  // Is the limiter actually bound on the live Worker? (health reports booleans only.) A missing binding fails open, which
  // looks exactly like "the limit does not work", so name it. Older Workers without the field report "unknown".
  const health = await f(`${base}/health`).then((r) => r.json()).catch(() => ({}));
  const rl = health?.rate_limit;
  results.push(check("RATE_LIMITER binding is attached on the live Worker", rl ? rl.sender === true : true,
    rl ? `sender ${rl.sender}, global ${rl.global}` : "health does not report rate_limit yet (unknown)"));
  const post = (sender) => f(`${base}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MPT-Webhook-Secret": secret },
    body: JSON.stringify({ platform: "telegram", sender_id: sender, message_text: MESSAGE }),
  });

  const statuses = [];
  let firstLimited = null;
  for (let i = 1; i <= count; i++) {
    const res = await post(`rl-probe-${stamp}`);
    statuses.push(res.status);
    if (res.status === 429 && !firstLimited) firstLimited = res;
  }
  const first429 = statuses.indexOf(429) + 1; // 0 when none
  const body = firstLimited ? await firstLimited.json().catch(() => ({})) : {};
  results.push(
    check(`first ${LIMIT} requests for one sender -> 200`, statuses.slice(0, LIMIT).every((s) => s === 200), `statuses ${statuses.slice(0, LIMIT).join(",")}`),
    check(`first 429 arrives by request ${LIMIT + 1 + SLACK} (spec: 11th, limiter is approximate)`, first429 >= LIMIT + 1 && first429 <= LIMIT + 1 + SLACK, first429 ? `first 429 at request ${first429}` : "no 429 in any request"),
    check("requests after the first 429 stay 429", first429 > 0 && statuses.slice(first429 - 1).every((s) => s === 429), `statuses ${statuses.join(",")}`),
    check("429 carries error.code rate_limited", body?.error?.code === "rate_limited", `code "${body?.error?.code ?? "none"}"`),
    check("429 carries Retry-After: 60", firstLimited?.headers?.get?.("retry-after") === "60", `Retry-After "${firstLimited?.headers?.get?.("retry-after") ?? "none"}"`),
  );
  const other = await post(`rl-probe-${stamp}-other`);
  results.push(check("a different sender is not limited -> 200", other.status === 200, `status ${other.status}`));
  return results;
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") opts.baseUrl = argv[++i];
    else if (argv[i] === "--count") opts.count = Number(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (opts.count !== undefined && !(Number.isInteger(opts.count) && opts.count > LIMIT && opts.count <= 30)) {
    throw new Error(`--count must be an integer from ${LIMIT + 1} to 30`);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { baseUrl, count } = parseArgs(process.argv.slice(2));
    const results = await probe((baseUrl || BASE).replace(/\/$/, ""), process.env.WEBHOOK_SECRET, { count });
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.detail})`);
    const failed = results.filter((r) => !r.ok);
    for (const r of failed) console.log(`::error::core-brain rate limit check failed: ${r.name} - ${r.detail}`);
    if (failed.length) process.exit(1);
    console.log("OK: core-brain rate limit works (first 429 by request 15, other senders unaffected)");
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
