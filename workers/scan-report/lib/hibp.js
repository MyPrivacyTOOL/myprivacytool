// Have I Been Pwned v3 breached-account lookup. Needs a paid key (HIBP_API_KEY, Worker secret).
// Returns { status: 'checked', breaches } | { status: 'not_checked', reason }. Never guesses.
export async function checkBreaches(email, env, fetchImpl = fetch) {
  if (!env.HIBP_API_KEY) return { status: 'not_checked', reason: 'HIBP API key not configured' };
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { 'hibp-api-key': env.HIBP_API_KEY, 'user-agent': 'MyPrivacyTOOL-scan-report' } });
    } catch (e) {
      return { status: 'not_checked', reason: `HIBP unreachable: ${String(e).slice(0, 100)}` };
    }
    if (res.status === 404) return { status: 'checked', breaches: [] };          // not in any breach
    if (res.status === 200) return { status: 'checked', breaches: await res.json() };
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers?.get?.('retry-after')) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return { status: 'not_checked', reason: `HIBP HTTP ${res.status}` };
  }
  return { status: 'not_checked', reason: 'HIBP rate limited' };
}
