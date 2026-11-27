// MPC-10612: the employee routes are limited per INVITATION (hashed token), not per office address, and a normal journey is not limited. No network, no secrets.
// Run: node workers/scan-report/business-limits.test.mjs
import worker from './index.js';
import { stub, ORIGIN } from './test-support/fake-accounts.mjs';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
// counting limiters like Cloudflare's binding: success until `limit` calls per key
const limiter = (limit) => { const n = {}; return { n, limit: async ({ key }) => { n[key] = (n[key] || 0) + 1; return { success: n[key] <= limit }; } }; };
const real = globalThis.fetch;
const S = stub(); globalThis.fetch = (u, o) => S.f(u, o);
const mkEnv = () => ({ ACCOUNTS_ENABLED: 'true', BUSINESS_TEAMS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'r', RECIPIENT_ALLOWLIST: '', UNSUBSCRIBE_SECRET: 't', RATE_LIMITER: limiter(5), LIVE_LIMITER: limiter(40), JOIN_LIMITER: limiter(300) });
const call = (env, path, token, ip = '203.0.113.7') => worker.fetch(new Request(`https://x.test${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ token }) }), env, { waitUntil() {} });
const tok = (c) => c.repeat(43);   // well-formed, unknown: the stub answers 404, but the limiter is consulted first
const statuses = async (env, path, token, n, ip) => { const out = []; for (let i = 0; i < n; i++) out.push((await call(env, path, token, ip)).status); return out; };

{ // one person's journey: view x5, authorise-class x2 on ONE token from one address: nothing limited (before: the 6th call was a 429)
  const env = mkEnv(); const a = tok('a');
  const s = [...await statuses(env, '/api/business/join/view', a, 5), ...await statuses(env, '/api/business/join/revoke', a, 2), ...await statuses(env, '/api/business/join/view', a, 3)];
  check(s.every((x) => x !== 429), `one invitation's journey (10 calls) is not limited: ${s.join(',')}`);
}
{ // the same token: reads stop at 40 a minute, changes stop at 5 a minute
  const env = mkEnv(); const a = tok('b');
  const v = await statuses(env, '/api/business/join/view', a, 41);
  check(v.slice(0, 40).every((x) => x !== 429) && v[40] === 429, 'reads: the 41st view of one token in a minute is a 429');
  const env2 = mkEnv(); const c = await statuses(env2, '/api/business/join/revoke', a, 6);
  check(c.slice(0, 5).every((x) => x !== 429) && c[5] === 429, 'changes: the 6th withdraw of one token in a minute is a 429');
}
{ // an office: 60 different people behind ONE address each do open + authorise + reload: nobody is limited (before: the 6th call from the address was; the first fix capped it at 40)
  const env = mkEnv(); let any429 = false, calls = 0;
  for (let i = 0; i < 60; i++) { const t = String(i).padStart(43, 'o'); for (const p of ['view', 'authorise', 'view']) { calls++; if ((await call(env, `/api/business/join/${p}`, t)).status === 429) any429 = true; } }
  check(!any429, `60 colleagues behind one office address (${calls} calls in a minute) are not limited`);
}
{ // a flood from one address is still capped: 300 a minute per address, whatever tokens it sends
  const env = mkEnv(); let first429 = -1;
  for (let i = 0; i < 320; i++) { if ((await call(env, '/api/business/join/view', String(i).padStart(43, 'f'))).status === 429 && first429 < 0) first429 = i; }
  check(first429 === 300, `a flood of random tokens from one address is capped at 300 a minute (first 429 at call ${first429 + 1})`);
}
{ // without the JOIN_LIMITER binding the old 40 a minute per-address cap still applies (fails safe, not open)
  const env = mkEnv(); delete env.JOIN_LIMITER; let first429 = -1;
  for (let i = 0; i < 60; i++) { if ((await call(env, '/api/business/join/view', String(i).padStart(43, 'g'))).status === 429 && first429 < 0) first429 = i; }
  check(first429 === 40, `no JOIN_LIMITER: the per-address cap falls back to 40 a minute (first 429 at call ${first429 + 1})`);
}
{ // a malformed token falls back to the strict per-address limit (5 a minute)
  const env = mkEnv(); const s = await statuses(env, '/api/business/join/view', 'short', 7);
  check(s.slice(0, 5).every((x) => x !== 429) && s[5] === 429, `a malformed token keeps the strict per-address limit: ${s.join(',')}`);
}
globalThis.fetch = real;
console.log(ok ? 'ALL PASS' : 'FAILED'); process.exit(ok ? 0 : 1);
