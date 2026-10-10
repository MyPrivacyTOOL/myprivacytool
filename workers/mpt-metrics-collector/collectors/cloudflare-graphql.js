// Shared Cloudflare GraphQL Analytics API helper (MPC-7381). Read-only: the token needs "Analytics Read" and nothing else.
// CLOUDFLARE_ANALYTICS_TOKEN is deliberately NOT the deploy token (CLOUDFLARE_API_TOKEN in GitHub Actions).
export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// UTC calendar day before `now`: the last complete day when the cron fires at 00:15 UTC.
export function yesterdayUtc(now) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 86400000);
  return { start, end, date: start.toISOString().slice(0, 10) };
}

// Runs one query and returns the untouched `data` object. Throws on HTTP errors, GraphQL errors or an empty result,
// so the caller records status=error with a blank payload instead of a partial or guessed number.
export async function cfQuery(env, query, variables) {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN) throw new Error('CLOUDFLARE_ANALYTICS_TOKEN not set');
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Cloudflare GraphQL HTTP ${res.status}`);
  const body = await res.json();
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(`Cloudflare GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  if (!body.data) throw new Error('Cloudflare GraphQL: no data');
  return body.data;
}
