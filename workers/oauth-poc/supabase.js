/**
 * MPC-6971 — link an OAuth identity to an existing Supabase auth user.
 *
 * Reads only: calls the SECURITY DEFINER function public.mpt_find_auth_user_by_email (see
 * supabase/migrations/20261006140000_oauth_find_auth_user.sql) with the service_role key. It returns the user's
 * id when a *confirmed* auth.users row has that email, else null. The Worker never creates or edits auth users.
 *
 * Optional: with SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset the link state is 'not_configured' and sign-in
 * still works. The key is held back until the MPC-6950 rotation, so this must fail soft and visibly.
 */

/** @returns {Promise<{state: 'linked'|'not_found'|'not_configured'|'error', uid: string|null}>} */
export async function linkAuthUser(env, email, fetchFn = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { state: 'not_configured', uid: null };
  try {
    const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/mpt_find_auth_user_by_email`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email }),
    });
    if (!res.ok) return { state: 'error', uid: null };
    const uid = await res.json().catch(() => null);
    return typeof uid === 'string' && uid ? { state: 'linked', uid } : { state: 'not_found', uid: null };
  } catch {
    return { state: 'error', uid: null };
  }
}
