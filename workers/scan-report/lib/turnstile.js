// MPC-8430: Cloudflare Turnstile for POST /api/scan (same design as workers/mpt-leads, MPC-8368). The Scan page widget sends a token
// as `cf-turnstile-response`; it is verified against TURNSTILE_SECRET_KEY (the secret of the widget created for this Worker).
// Returns 'absent' (secret not set: feature off), 'ok', 'failed' (missing, invalid, reused or wrong-hostname token) or
// 'error' (siteverify unreachable: fails open so a Cloudflare hiccup never drops a real request). Blocking is opt-in via
// TURNSTILE_ENFORCE = "true"; until then a 'failed' result is only logged.
// Privacy: the TURNSTILE_FAILED log keeps a coarse network prefix (IPv4 /24, IPv6 /48), never the visitor's full address, email or token.
export const TURNSTILE_HOSTS = ['myprivacytool.io', 'www.myprivacytool.io', 'wwwmyprivacytool.pages.dev'];
const clip = (v, n) => String(v ?? '').slice(0, n);

export function maskIp(ip) {
  const s = String(ip || '');
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/); // also IPv4-mapped IPv6 (::ffff:1.2.3.4)
  if (v4) return v4[1] + '.0/24';
  if (s.includes(':')) {
    const g = s.split(':');
    return g[0] && g[1] && g[2] ? `${g[0]}:${g[1]}:${g[2]}::/48` : 'ipv6';
  }
  return '';
}

export async function turnstileState(env, request, token, info = {}, fetchImpl = fetch) {
  if (!env.TURNSTILE_SECRET_KEY) return 'absent';
  if (typeof token !== 'string' || !token) { info.reason = 'missing_token'; return 'failed'; }
  if (token.length > 2048) { info.reason = 'token_too_long'; return 'failed'; }
  try {
    const fd = new FormData();
    fd.append('secret', env.TURNSTILE_SECRET_KEY);
    fd.append('response', token);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) fd.append('remoteip', ip);
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd });
    if (!res.ok) { console.warn('turnstile siteverify http', res.status); return 'error'; }
    const out = await res.json();
    if (!out.success) { info.reason = 'rejected:' + (out['error-codes'] || []).join(',').slice(0, 100); return 'failed'; }
    if (out.hostname && !TURNSTILE_HOSTS.includes(out.hostname)) { info.reason = 'hostname_mismatch:' + clip(out.hostname, 100); return 'failed'; }
    return 'ok';
  } catch (e) {
    console.warn('turnstile error:', String(e && e.message || e).slice(0, 200));
    return 'error';
  }
}

/** Runs the check and writes the TURNSTILE_FAILED log line. Returns true when the request must be refused (403). */
export async function turnstileBlocks(env, request, token, origin, fetchImpl = fetch) {
  const info = {};
  if (await turnstileState(env, request, token, info, fetchImpl) !== 'failed') return false;
  const enforce = String(env.TURNSTILE_ENFORCE).toLowerCase() === 'true';
  console.warn('TURNSTILE_FAILED ' + JSON.stringify({
    ts: new Date().toISOString(),
    worker: 'mpt-scan-report',
    ip: maskIp(request.headers.get('CF-Connecting-IP')),
    country: request.cf?.country || '',
    origin: origin || '',
    reason: info.reason || 'unknown',
    action: enforce ? 'blocked_403' : 'allowed_report_only',
  }));
  return enforce;
}
