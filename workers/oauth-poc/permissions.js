/**
 * MPC-6971 — provider permission-API catalogue served by GET /v1/permissions.
 * Mirrors docs/phase5-oauth-permission-apis.md section 3. `verified` is true only where a live call proved it
 * (Google consumer, 2026-10-05); everything else is public documentation, **Pending Live Verification**.
 */
export const PROVIDERS = [
  {
    id: 'google', account_type: 'consumer', verified: true,
    can_list_grants: false, can_revoke_grants: false, mode: 'guided_audit',
    guided_audit_url: 'https://myaccount.google.com/connections',
    note: 'tokeninfo/userinfo describe MPT\'s own token only; no endpoint lists other apps\' grants (MPC-6960).',
  },
  {
    id: 'google', account_type: 'workspace', verified: false,
    can_list_grants: true, can_revoke_grants: true, mode: 'admin_only',
    note: 'Admin SDK tokens.list / tokens.delete need an admin scope, Google verification and CASA. Conditional on a committed customer.',
  },
  {
    id: 'microsoft', account_type: 'entra', verified: false,
    can_list_grants: true, can_revoke_grants: true, mode: 'automated_candidate',
    note: '/me/oauth2PermissionGrants and DELETE /oauth2PermissionGrants/{id}. Pending Live Verification.',
  },
  {
    id: 'github', account_type: 'user', verified: false,
    can_list_grants: false, can_revoke_grants: true, mode: 'guided_audit',
    guided_audit_url: 'https://github.com/settings/applications',
    note: 'No public REST list of a user\'s authorised apps; an OAuth App can revoke its own grant. Pending Live Verification.',
  },
  {
    id: 'slack', account_type: 'member', verified: false,
    can_list_grants: false, can_revoke_grants: false, mode: 'guided_audit',
    note: 'admin.apps.* is Enterprise Grid admin only. Pending Live Verification.',
  },
];

export function permissionsView(session, scopeCatalogue) {
  return {
    authenticated: !!session,
    granted: session ? session.scp : [],
    scopes: Object.entries(scopeCatalogue).map(([name, s]) => ({
      name, description: s.description,
      available: s.held,
      granted: !!session && session.scp.includes(name),
    })),
    providers: PROVIDERS,
  };
}
