/** Small HTTP helpers shared by the channel route handlers (GitHub in index.js, Reddit in reddit-routes.js). */

export const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

// ALLOWED_ORIGIN may list several origins, comma-separated (apex + www).
export const allowedOrigins = (env) => String(env.ALLOWED_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
export const originAllowed = (env, origin) => !!origin && allowedOrigins(env).includes(origin);

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!originAllowed(env, origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export function readCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}

export const setCookie = (name, value, maxAge, path, sameSite) =>
  `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
