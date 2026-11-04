// MPT (MyPrivacyTOOL) shared utils. Microdrama: every worker imports from here so the
// cast of characters (json, logging, env checks) never changes between scenes.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function log(worker, event, fields = {}) {
  // One JSON line per event; never pass secrets or personal data in `fields`.
  console.log(JSON.stringify({ worker, event, ...fields }));
}

// Microdrama: returns the names of required env bindings that are missing (names only, never values).
export function missingEnv(env, names) {
  return names.filter((n) => !env[n]);
}

// CK-007: structured logger + typed errors (TypeScript sources, bundled by wrangler/esbuild).
export { createLogger } from "./logger.ts";
export { MptError, errorResponse, toMptError } from "./errors.ts";
