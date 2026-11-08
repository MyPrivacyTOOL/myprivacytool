// Have I Been Pwned v3 breached-account lookup. Needs a paid key (HIBP_API_KEY, Worker secret).
// Returns { status: 'checked', breaches } | { status: 'not_checked', reason } | { status: 'rate_limited', reason }.
// 'rate_limited' means "try again on a later run": the caller must not count it as a failed attempt or report it as unchecked. Never guesses.
// Paid keys allow 10 requests/minute, so calls are spaced HIBP_MIN_INTERVAL_MS apart (default 6500) within one Worker isolate.
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { rcx } from './recipients.js';
let lastCallAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pace(env) {
  const gap = Number(env.HIBP_MIN_INTERVAL_MS ?? 6500);
  const wait = lastCallAt + gap - Date.now();
  if (lastCallAt && wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

export async function checkBreaches(email, env, fetchImpl = undefined, rctx = undefined) {
  if (!env.HIBP_API_KEY) return { status: 'not_checked', reason: 'HIBP API key not configured' };
  const ctx = rcx(env, fetchImpl, rctx);
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await pace(env);
    let res;
    try {
      res = await callRecipient('hibp', { url, sent: ['email'], init: { headers: { 'hibp-api-key': env.HIBP_API_KEY, 'user-agent': 'MyPrivacyTOOL-scan-report' } } }, ctx);
    } catch (e) {
      // MPC-9885: hibp is switched off in the registry (MPC-9823 / MPC-9904). The wrapper refusing is the same answer as having no key.
      if (e?.name === 'RecipientError' && (e.code === 'DISABLED' || e.code === 'FLAG_OFF')) return { status: 'not_checked', reason: 'HIBP API key not configured' };
      return { status: 'not_checked', reason: `HIBP unreachable: ${String(e).slice(0, 100)}` };
    }
    if (res.status === 404) return { status: 'checked', breaches: [] };          // not in any breach
    if (res.status === 200) return { status: 'checked', breaches: await res.json() };
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers?.get?.('retry-after')) || 2, 10);
      await sleep(wait * 1000);
      continue;
    }
    return { status: 'not_checked', reason: `HIBP HTTP ${res.status}` };
  }
  return { status: 'rate_limited', reason: 'HIBP rate limited' };
}
