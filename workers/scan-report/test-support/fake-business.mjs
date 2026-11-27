// MPC-9824: the mpt_business_* rpcs for the stub in fake-accounts.mjs. It applies the same rules as migration 20261108160000_mpc_9824_business_teams.sql plus
// 20261115000000_mpc_9824_summary_member_id.sql (the SQL itself is proved in supabase/tests/mpc-9824-business-teams.test.sql). No network, SYNTHETIC identities only.
export const businessState = () => ({ teams: [], members: [], requests: [] });
const THIRTY_DAYS = 30 * 86400000;

export function businessRpc(bs, accounts, fn, b) {
  const team = (id) => bs.teams.find((t) => t.id === id);
  const byHash = (h) => bs.members.find((m) => m.token_hash === h);
  const live = (m) => m && (m.token_expires_at >= Date.now() || m.status === 'authorised');
  const clear = (m) => { m.results = null; m.checked_at = null; m.share_detail = false; };
  switch (fn) {
    case 'mpt_business_create_team': {
      const a = accounts.find((x) => x.id === b.p_account); if (!a) return { created: false, reason: 'no_account' };
      if (bs.teams.filter((t) => t.admin_account_id === b.p_account).length >= 5) return { created: false, reason: 'team_limit' };
      bs.requests.push({ ref: b.p_ref, contact_email: a.email, company: b.p_company, source: 'admin_invite' });
      const t = { id: crypto.randomUUID(), admin_account_id: b.p_account, company: b.p_company, request_ref: b.p_ref, created_at: new Date().toISOString() }; bs.teams.push(t);
      return { created: true, team_id: t.id, company: t.company, request_ref: t.request_ref };
    }
    case 'mpt_business_list_teams': return bs.teams.filter((t) => t.admin_account_id === b.p_account).map((t) => ({ team_id: t.id, company: t.company, created_at: t.created_at }));
    case 'mpt_business_invite': {
      const t = team(b.p_team); if (!t || t.admin_account_id !== b.p_account) return { ok: false, reason: 'not_your_team' };
      const added = [], skipped = [];
      b.p_emails.forEach((raw, i) => {
        const email = raw.toLowerCase().trim(); const m = bs.members.find((x) => x.team_id === t.id && x.email === email);
        if (m) {
          if (m.status === 'declined' || m.status === 'revoked' || (m.status === 'invited' && m.token_expires_at < Date.now())) {
            Object.assign(m, { token_hash: b.p_hashes[i], status: 'invited', token_expires_at: Date.now() + THIRTY_DAYS, consent_version: null, consent_at: null }); clear(m); added.push(email);
          } else skipped.push(email);
        } else if (bs.members.filter((x) => x.team_id === t.id).length >= 50) skipped.push(email);
        else { bs.members.push({ id: crypto.randomUUID(), team_id: t.id, email, token_hash: b.p_hashes[i], status: 'invited', token_expires_at: Date.now() + THIRTY_DAYS, share_detail: false, results: null, checked_at: null, consent_version: null, invited_at: bs.members.length }); added.push(email); }
      });
      return { ok: true, added, skipped };
    }
    case 'mpt_business_member': {
      const m = byHash(b.p_hash); if (!live(m)) return null;
      return { member_id: m.id, email: m.email, status: m.status, company: team(m.team_id).company, share_detail: m.share_detail, checked_at: m.checked_at, results: m.results, team_id: m.team_id };
    }
    case 'mpt_business_authorise': {
      const m = byHash(b.p_hash); if (!live(m)) return { ok: false, reason: 'invalid_link' };
      if (m.status === 'revoked') return { ok: false, reason: 'revoked' };
      if (!Array.isArray(b.p_results) || b.p_results.length > 3) return { __error: 400 };
      const first = m.status !== 'authorised';
      Object.assign(m, { status: 'authorised', consent_version: b.p_version, consent_at: Date.now(), share_detail: b.p_share === true, results: b.p_results, checked_at: new Date().toISOString() });
      const company = team(m.team_id).company;
      if (first && b.p_ref) bs.requests.push({ ref: b.p_ref, contact_email: m.email, company, source: 'employee_consent' });
      return { ok: true, status: 'authorised', company };
    }
    case 'mpt_business_decline': { const m = byHash(b.p_hash); if (!m || !['invited', 'declined'].includes(m.status) || m.token_expires_at < Date.now()) return { ok: false }; m.status = 'declined'; clear(m); return { ok: true }; }
    case 'mpt_business_revoke': { const m = byHash(b.p_hash); if (!m || !['authorised', 'invited', 'declined'].includes(m.status)) return { ok: false }; m.status = 'revoked'; clear(m); m.consent_version = null; return { ok: true }; }
    case 'mpt_business_set_share': { const m = byHash(b.p_hash); if (!m || m.status !== 'authorised') return { ok: false }; m.share_detail = b.p_share === true; return { ok: true, share_detail: m.share_detail }; }
    case 'mpt_business_summary': {
      const t = team(b.p_team); if (!t || t.admin_account_id !== b.p_account) return null;
      const all = bs.members.filter((m) => m.team_id === t.id); const n = (s) => all.filter((m) => m.status === s).length;
      const auth = all.filter((m) => m.status === 'authorised' && m.results); const rs = auth.flatMap((m) => m.results);
      return { team_id: t.id, company: t.company, request_ref: t.request_ref,
        counts: { invited_total: all.length, awaiting: n('invited'), authorised: n('authorised'), declined: n('declined'), revoked: n('revoked') },
        aggregate: { people_included: n('authorised'), people_with_a_listing: auth.filter((m) => m.results.some((r) => r.state === 'listed')).length, pages_checked: rs.length,
          listed: rs.filter((r) => r.state === 'listed').length, not_listed: rs.filter((r) => r.state === 'not_listed').length, not_checked: rs.filter((r) => r.state === 'not_checked').length },
        members: all.map((m) => ({ member_id: m.id, email: m.email, status: m.status, shared: m.share_detail, detail: m.status === 'authorised' && m.share_detail ? m.results : null })) };
    }
    case 'mpt_business_remove_member': {
      const t = team(b.p_team); const i = bs.members.findIndex((m) => m.id === b.p_member && m.team_id === b.p_team);
      if (!t || t.admin_account_id !== b.p_account || i < 0) return { ok: false }; bs.members.splice(i, 1); return { ok: true };
    }
    case 'mpt_business_delete_team': {
      const t = team(b.p_team); if (!t || t.admin_account_id !== b.p_account) return { ok: false };
      const k = bs.members.filter((m) => m.team_id === t.id).length; bs.members = bs.members.filter((m) => m.team_id !== t.id); bs.teams = bs.teams.filter((x) => x.id !== t.id);
      return { ok: true, members_deleted: k };
    }
    default: return undefined;
  }
}
