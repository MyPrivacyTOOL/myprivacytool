#!/usr/bin/env node
// MPC-7300: post-deployment smoke tests against the LIVE services. Read-only / side-effect free:
//   - mpt-leads is probed with CORS preflight and the watchdog "@healthcheck.io" email, which the Worker
//     short-circuits without writing to Notion, Supabase, HubSpot, Slack or Resend.
//   - oauth-poc is probed at /health and /oauth/google/start (a redirect; nothing is exchanged or stored).
//   - core-brain is probed at /health (must report configured:true) and for auth: POST /webhook without the
//     secret must be 401. No secret is needed and no message is classified, so nothing reaches Qwen or Supabase.
//   - the site is probed for HTTP 200 + the SPA shell on the conversion routes.
//
//   node scripts/ci/smoke-test.mjs <site|mpt-leads|oauth-poc|core-brain> [--base-url URL] [--retries N] [--delay-ms MS] [--expect-sha SHA]
// Retries cover Cloudflare propagation after a deploy. Exits 1 with ::error:: annotations on failure.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  site: "https://www.myprivacytool.io",
  "mpt-leads": "https://mpt-leads.myprivacytool.workers.dev",
  "oauth-poc": "https://myprivacytool-oauth-poc.myprivacytool.workers.dev",
  "core-brain": "https://brain.myprivacytool.io", // MPC-7260 production custom domain
};
export const SITE_ROUTES = ["/", "/scan", "/start", "/contact", "/newsletter", "/pricing", "/privacy"];

const check = (name, ok, detail = "") => ({ name, ok: Boolean(ok), detail });

export const targets = {
  async site(base, f = fetch, { expectSha } = {}) {
    const results = [];
    for (const route of SITE_ROUTES) {
      const res = await f(base + route, { redirect: "follow" });
      const html = res.ok ? await res.text() : "";
      results.push(check(`GET ${route} -> 200`, res.status === 200, `status ${res.status}`));
      if (res.ok) {
        results.push(check(`GET ${route} serves the SPA shell`, /<div id="root"/.test(html) && /<title>[^<]+<\/title>/.test(html), "missing #root or <title>"));
      }
    }
    const sm = await f(`${base}/sitemap.xml`);
    results.push(check("GET /sitemap.xml -> 200 XML", sm.status === 200 && /<urlset/.test(await sm.text()), `status ${sm.status}`));
    if (expectSha) {
      // MPC-7505: prove the NEW deploy is being served, not just that the previous one still answers.
      const v = await f(`${base}/version.json`, { headers: { "Cache-Control": "no-cache" } });
      const live = v.ok ? (await v.json().catch(() => ({}))).sha : undefined;
      results.push(check(`/version.json serves commit ${expectSha.slice(0, 7)}`, live === expectSha, `status ${v.status}, live sha ${live ? String(live).slice(0, 7) : "none"}`));
    }
    return results;
  },

  async "mpt-leads"(base, f = fetch) {
    const origin = "https://myprivacytool.io";
    const pre = await f(base, { method: "OPTIONS", headers: { Origin: origin } });
    const hc = await f(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "watchdog@healthcheck.io" }),
    });
    const body = await hc.json().catch(() => ({}));
    const get = await f(base, { method: "GET" });
    return [
      check("OPTIONS preflight -> 204", pre.status === 204, `status ${pre.status}`),
      check("CORS allows the production origin", pre.headers.get("access-control-allow-origin") === origin, String(pre.headers.get("access-control-allow-origin"))),
      check("healthcheck POST -> 200 {success, note:healthcheck}", hc.status === 200 && body.success === true && body.note === "healthcheck", `status ${hc.status} ${JSON.stringify(body)}`),
      check("GET -> 404 (POST-only)", get.status === 404, `status ${get.status}`),
    ];
  },

  async "oauth-poc"(base, f = fetch) {
    const health = await f(`${base}/health`);
    const hb = await health.json().catch(() => ({}));
    const start = await f(`${base}/oauth/google/start`, { redirect: "manual" });
    const loc = start.headers.get("location") || "";
    const nf = await f(`${base}/nope`);
    return [
      check("/health -> {status:ok}", health.status === 200 && hb.status === "ok", `status ${health.status}`),
      check("/oauth/google/start -> 302 to Google", start.status === 302 && loc.startsWith("https://accounts.google.com/"), `status ${start.status} ${loc.slice(0, 40)}`),
      check("start sets an HttpOnly state cookie", /HttpOnly/.test(start.headers.get("set-cookie") || ""), "no HttpOnly Set-Cookie"),
      check("unknown path -> 404", nf.status === 404, `status ${nf.status}`),
    ];
  },
};

targets["core-brain"] = async (base, f = fetch) => {
  const health = await f(`${base}/health`);
  const hb = await health.json().catch(() => ({}));
  const anon = await f(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const get = await f(`${base}/webhook`, { method: "GET" });
  const nf = await f(`${base}/nope`);
  return [
    check("/health -> {ok, worker:core-brain, configured:true}", health.status === 200 && hb.ok === true && hb.worker === "core-brain" && hb.configured === true, `status ${health.status} ${JSON.stringify(hb)}`),
    check("POST /webhook without the secret -> 401", anon.status === 401, `status ${anon.status}`),
    check("GET /webhook -> 405 (POST-only)", get.status === 405, `status ${get.status}`),
    check("unknown path -> 404", nf.status === 404, `status ${nf.status}`),
  ];
};

export async function smoke(target, { baseUrl, retries = 5, delayMs = 15000, fetchFn = fetch, expectSha, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  if (!targets[target]) throw new Error(`unknown target "${target}" (expected ${Object.keys(targets).join(", ")})`);
  const base = (baseUrl || DEFAULTS[target]).replace(/\/$/, "");
  let results = [];
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      results = await targets[target](base, fetchFn, { expectSha });
    } catch (e) {
      results = [check(`reach ${base}`, false, e.message)];
    }
    const failed = results.filter((r) => !r.ok);
    log(`attempt ${attempt}/${retries}: ${results.length - failed.length}/${results.length} checks passed`);
    if (!failed.length) return { ok: true, results, attempts: attempt };
    if (attempt < retries) await sleep(delayMs);
  }
  return { ok: false, results, attempts: retries };
}

export function parseArgs(argv) {
  const [target, ...rest] = argv;
  const opts = { target };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (k === "--base-url") opts.baseUrl = rest[++i];
    else if (k === "--retries") opts.retries = Number(rest[++i]);
    else if (k === "--delay-ms") opts.delayMs = Number(rest[++i]);
    else if (k === "--expect-sha") opts.expectSha = rest[++i];
    else throw new Error(`unknown argument ${k}`);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { target, ...opts } = parseArgs(process.argv.slice(2));
    const out = await smoke(target, opts);
    for (const r of out.results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : ` (${r.detail})`}`);
    if (!out.ok) {
      for (const r of out.results.filter((x) => !x.ok)) console.log(`::error::smoke test failed (${target}): ${r.name} - ${r.detail}`);
      process.exit(1);
    }
    console.log(`OK: ${target} smoke test passed`);
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
