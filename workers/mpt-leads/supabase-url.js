// CK-11575: the one place that decides which Supabase project this Worker talks to.
// Production (ENVIRONMENT unset or "production") keeps the production URL as the fallback, exactly as before.
// Any other ENVIRONMENT (development, staging, ...) must set SUPABASE_URL explicitly; if it does not, this returns null
// and every caller skips its Supabase call. A non-production run that forgot SUPABASE_URL must never write to production.
export const DEFAULT_SUPABASE_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';

export function resolveSupabaseUrl(env) {
  if (env.SUPABASE_URL) return env.SUPABASE_URL;
  const e = String(env.ENVIRONMENT || 'production').trim().toLowerCase();
  return e === 'production' ? DEFAULT_SUPABASE_URL : null;
}

// One log line, host-free, that says why a Supabase call was skipped.
export const missingSupabaseUrlMessage = (env) =>
  `SUPABASE_URL is required when ENVIRONMENT=${env.ENVIRONMENT}; refusing the production default`;
