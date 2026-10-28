/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MPC-8737 — the PoP gate's window onto the data-point ledger.
 *
 * The ledger schema is not exposed to the REST API (design H7), so the Worker reaches it through three service_role-only public RPCs
 * (supabase/migrations/20261028120000_mpc_8737_data_point_ledger_v1.sql):
 *   mpt_ledger_pop_bind    writes the proof: person + proven wa_id identifier + a phone.possession_proof data point (taken / webhook / 100)
 *   mpt_ledger_pop_check   reads the proof for a session and the newest unexpired revocation for the same person
 *   mpt_ledger_pop_revoke  writes a phone.possession_revoked data point
 * The Worker keeps every decision (flag, consent version, target, revocation order). These functions only store and read.
 *
 * Like state-store.js's strict functions, everything here reports failure as { ok:false } / false and never throws or guesses:
 * a proof that could not be written or read is NOT "missing", it is an outage, and the caller fails closed.
 */
import { SUPABASE_DEFAULT_URL } from './supabase-client.js';

type Env = Record<string, any>;

export interface LedgerProof { wa: string; bound_at_ms: number; inbound_ts: number; consent_v: string | null; consent_accepted: boolean }
export type ProofRead = { ok: true; proof: LedgerProof | null; revoked_at_ms: number | null } | { ok: false };

const ledgerConfigured = (env: Env) => !!env.SUPABASE_SERVICE_ROLE_KEY;

async function rpc(env: Env, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; body?: any }> {
  if (!ledgerConfigured(env)) return { ok: false };
  try {
    const res = await fetch(`${env.SUPABASE_URL || SUPABASE_DEFAULT_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return { ok: false };
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false };
  }
}

/** Durably record the proof. true only when the database confirmed it. `sid` is the HMAC of the session token, never the token. */
export async function bindProof(env: Env, p: { sid: string; wa: string; boundAtMs: number; inboundTs: number; consentV: string | undefined; consentAccepted: boolean; msgHash: string | null; ttlMs: number }): Promise<boolean> {
  const r = await rpc(env, 'mpt_ledger_pop_bind', {
    p_sid: p.sid, p_wa: p.wa, p_bound_at_ms: p.boundAtMs, p_inbound_ts: p.inboundTs, p_consent_v: p.consentV ?? '', p_consent_accepted: p.consentAccepted,
    p_msg: p.msgHash, p_ttl_seconds: Math.max(1, Math.round(p.ttlMs / 1000)),
  });
  return r.ok && r.body === true;
}

/** Read the proof and the newest revocation in one call. A response of any other shape is an outage, not "no proof". */
export async function readProof(env: Env, sid: string): Promise<ProofRead> {
  const r = await rpc(env, 'mpt_ledger_pop_check', { p_sid: sid });
  const b = r.body;
  if (!r.ok || !b || typeof b !== 'object' || !('proof' in b) || !('revoked_at_ms' in b)) return { ok: false };
  const rev = b.revoked_at_ms;
  if (rev !== null && typeof rev !== 'number') return { ok: false };
  const p = b.proof;
  if (p === null) return { ok: true, proof: null, revoked_at_ms: rev };
  if (!p || typeof p.wa !== 'string' || typeof p.bound_at_ms !== 'number' || typeof p.inbound_ts !== 'number') return { ok: false };
  return { ok: true, proof: { wa: p.wa, bound_at_ms: p.bound_at_ms, inbound_ts: p.inbound_ts, consent_v: typeof p.consent_v === 'string' ? p.consent_v : null, consent_accepted: p.consent_accepted === true }, revoked_at_ms: rev };
}

/** STOP / DELETE. true when the revocation is recorded (or there was no proof for that number to kill). */
export async function revokeProof(env: Env, wa: string, atMs: number, ttlMs: number): Promise<boolean> {
  const r = await rpc(env, 'mpt_ledger_pop_revoke', { p_wa: wa, p_at_ms: atMs, p_ttl_seconds: Math.max(1, Math.round(ttlMs / 1000)) });
  return r.ok && r.body === true;
}
