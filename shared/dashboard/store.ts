// MPC-7893: the dashboard's view of Supabase. The same tables the bot writes (profile_snapshots, deep_jobs, deep_osint_results), read with the
// service key held by the Pages Function; the browser never sees the key or a table. Tests inject an in-memory store.

export interface SessionRow { sender_id: string; snapshot_id: string }
export interface SnapshotRow {
  id: string; created_at: string; sender_id: string; status: string; scan_version: string; risk_version: string; schema_version: number; expires_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report: any;
}
export interface DeepJobRow { id: string; created_at: string; status: string; detector_version: string; finished_at: string | null; expires_at: string }
export interface DeepResultRow { source: string; site_name: string; status: string; observed_at: string; detector_version: string; limitation: string }

/** "unavailable" means the read itself failed (outage, table not deployed): the view says so instead of pretending there is no data. */
export type Read<T> = { ok: true; value: T } | { ok: false };

export interface DashboardStore {
  /** Atomic: true for exactly one caller. */
  redeem(tokenHash: string, sessionHash: string): Promise<Read<boolean>>;
  session(sessionHash: string): Promise<Read<SessionRow | null>>;
  snapshot(id: string, senderId: string): Promise<Read<SnapshotRow | null>>;
  /** Newest complete snapshot of this sender created after `afterIso`, or null. */
  laterSnapshot(senderId: string, afterIso: string): Promise<Read<SnapshotRow | null>>;
  latestDeepJob(senderId: string): Promise<Read<DeepJobRow | null>>;
  deepResults(jobId: string): Promise<Read<DeepResultRow[]>>;
}

export interface DashboardEnv {
  DASHBOARD_ENABLED?: string; // "1" to serve; anything else answers 503 and redeems nothing
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

const SNAPSHOT_COLUMNS = "id,created_at,sender_id,status,scan_version,risk_version,schema_version,expires_at,report";
const TIMEOUT_MS = 5000;
const enc = encodeURIComponent;

export function supabaseStore(env: DashboardEnv, fetchImpl: typeof fetch = fetch): DashboardStore | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  const base = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/";
  const headers = { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json" };
  async function get<T>(path: string): Promise<Read<T[]>> {
    try {
      const res = await fetchImpl(base + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return { ok: false };
      return { ok: true, value: (await res.json()) as T[] };
    } catch {
      return { ok: false };
    }
  }
  const first = async <T>(path: string): Promise<Read<T | null>> => {
    const r = await get<T>(path);
    return r.ok ? { ok: true, value: r.value[0] ?? null } : { ok: false };
  };
  const nowIso = () => new Date().toISOString();
  return {
    async redeem(tokenHash, sessionHash) {
      try {
        const res = await fetchImpl(base + "rpc/mpt_redeem_dashboard_link", {
          method: "POST", headers, signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({ p_token_hash: tokenHash, p_session_hash: sessionHash, p_session_minutes: 30 }),
        });
        if (!res.ok) return { ok: false };
        return { ok: true, value: (await res.json()) === true };
      } catch {
        return { ok: false };
      }
    },
    session: (h) => first<SessionRow>(`dashboard_sessions?select=sender_id,snapshot_id&session_hash=eq.${enc(h)}&revoked_at=is.null&expires_at=gt.${enc(nowIso())}&limit=1`),
    // The sender filter is the access check: a session for one sender can never read another sender's row, whatever id is asked for.
    snapshot: (id, sender) => first<SnapshotRow>(`profile_snapshots?select=${SNAPSHOT_COLUMNS}&id=eq.${enc(id)}&sender_id=eq.${enc(sender)}&expires_at=gt.${enc(nowIso())}&limit=1`),
    laterSnapshot: (sender, after) => first<SnapshotRow>(`profile_snapshots?select=${SNAPSHOT_COLUMNS}&sender_id=eq.${enc(sender)}&status=eq.complete&created_at=gt.${enc(after)}&expires_at=gt.${enc(nowIso())}&order=created_at.desc&limit=1`),
    latestDeepJob: (sender) => first<DeepJobRow>(`deep_jobs?select=id,created_at,status,detector_version,finished_at,expires_at&sender_id=eq.${enc(sender)}&expires_at=gt.${enc(nowIso())}&order=created_at.desc&limit=1`),
    deepResults: (jobId) => get<DeepResultRow>(`deep_osint_results?select=source,site_name,status,observed_at,detector_version,limitation&job_id=eq.${enc(jobId)}&order=site_name.asc`),
  };
}
