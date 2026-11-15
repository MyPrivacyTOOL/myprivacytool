import { fetchRecipient, type DataItem } from "@/config/recipients";
import { loadSession, refreshSession } from "@/lib/account";
import { resolveScanApiUrl } from "@/lib/webScan";

// MPC-9824 (F6): the client for the Worker's business-team routes (workers/scan-report/lib/business.js). Every call goes through the recipient wrapper (entry
// "business-team-service"). Admin calls carry the account session (the same Bearer as /account); employee calls carry the token from the invite email, which sits
// in the URL fragment (#t=) so it is never sent in a URL. The name, city and phone an employee types are sent once to the check and never stored.
export const businessTeamsEnabled = (): boolean => import.meta.env.VITE_BUSINESS_TEAMS_ENABLED === "true" && import.meta.env.VITE_ACCOUNTS_ENABLED === "true";

type Json = Record<string, unknown>;
async function post(path: string, body: unknown, token: string | null, sent: DataItem[] = []): Promise<{ status: number; json: Json | null }> {
  const base = resolveScanApiUrl();
  if (!base) return { status: 0, json: null };
  try {
    const res = await fetchRecipient("business-team-service", {
      url: `${base}/api/business/${path}`, sent,
      init: { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) },
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Json | null };
  } catch { return { status: 0, json: null }; }
}

/** Admin call: refreshes the session once on 401. status 401 = signed out. */
async function admin(path: string, body: unknown, sent: DataItem[] = []): Promise<{ status: number; json: Json | null }> {
  const s = loadSession(); if (!s) return { status: 401, json: null };
  let r = await post(path, body, s.accessToken, sent);
  if (r.status === 401) {
    const ns = await refreshSession(); if (!ns) return { status: 401, json: null };
    r = await post(path, body, ns.accessToken, sent);
  }
  return r;
}

export interface TeamRef { teamId: string; company: string }
export interface ListingResult { name: string | null; state: "listed" | "not_listed" | "not_checked"; match: string | null; evidenceUrl: string | null; notCheckedReason: string | null }
export interface TeamMember { memberId: string | null; email: string; status: "invited" | "authorised" | "declined" | "revoked"; shared: boolean; detail: ListingResult[] | null }
export interface TeamSummary {
  teamId: string; company: string;
  counts: { invitedTotal: number; awaiting: number; authorised: number; declined: number; revoked: number };
  aggregate: { peopleIncluded: number; peopleWithListing: number; pagesChecked: number; listed: number; notListed: number; notChecked: number };
  members: TeamMember[];
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const readResult = (x: Json): ListingResult => ({
  name: typeof x.name === "string" ? x.name : null, state: x.state === "listed" || x.state === "not_listed" ? x.state : "not_checked",
  match: typeof x.match === "string" ? x.match : null, evidenceUrl: typeof x.evidence_url === "string" ? x.evidence_url : null, notCheckedReason: typeof x.not_checked_reason === "string" ? x.not_checked_reason : null,
});
const readSummary = (raw: unknown): TeamSummary | null => {
  const s = raw as Json | null;
  if (!s || typeof s.team_id !== "string") return null;
  const c = (s.counts ?? {}) as Json; const a = (s.aggregate ?? {}) as Json;
  return {
    teamId: s.team_id, company: String(s.company ?? ""),
    counts: { invitedTotal: num(c.invited_total), awaiting: num(c.awaiting), authorised: num(c.authorised), declined: num(c.declined), revoked: num(c.revoked) },
    aggregate: { peopleIncluded: num(a.people_included), peopleWithListing: num(a.people_with_a_listing), pagesChecked: num(a.pages_checked), listed: num(a.listed), notListed: num(a.not_listed), notChecked: num(a.not_checked) },
    members: (Array.isArray(s.members) ? (s.members as Json[]) : []).map((m) => ({
      memberId: typeof m.member_id === "string" ? m.member_id : null, email: String(m.email ?? ""), status: (["invited", "authorised", "declined", "revoked"].includes(String(m.status)) ? m.status : "invited") as TeamMember["status"],
      shared: m.shared === true, detail: Array.isArray(m.detail) ? (m.detail as Json[]).map(readResult) : null,
    })),
  };
};

/** The admin's teams and the summary of one of them. "signed_out" = no session; "error" = unavailable. */
export async function loadTeam(teamId?: string): Promise<{ teams: TeamRef[]; summary: TeamSummary | null } | "signed_out" | "error"> {
  const r = await admin("summary", teamId ? { team_id: teamId } : {});
  if (r.status === 401) return "signed_out";
  if (r.status !== 200 || !r.json) return "error";
  const teams = (Array.isArray(r.json.teams) ? (r.json.teams as Json[]) : []).flatMap((t) => (typeof t.team_id === "string" ? [{ teamId: t.team_id, company: String(t.company ?? "") }] : []));
  return { teams, summary: readSummary(r.json.summary) };
}
export async function createTeam(company: string): Promise<{ teamId: string } | "limit" | "error"> {
  const r = await admin("team", { company });
  if (r.status === 200 && typeof r.json?.team_id === "string") return { teamId: r.json.team_id };
  return r.status === 409 ? "limit" : "error";
}
export async function inviteEmails(teamId: string, emails: string[]): Promise<{ invited: number; sent: number; skipped: number } | "error"> {
  const r = await admin("invite", { team_id: teamId, emails }, ["email"]);
  return r.status === 200 && r.json ? { invited: num(r.json.invited), sent: num(r.json.sent), skipped: num(r.json.skipped) } : "error";
}
export async function removeMember(teamId: string, memberId: string): Promise<boolean> { return (await admin("remove-member", { team_id: teamId, member_id: memberId })).status === 200; }
export async function deleteTeam(teamId: string): Promise<boolean> { return (await admin("delete-team", { team_id: teamId, confirm: "delete" })).status === 200; }

// ---- employee side (token from the invite email)
export interface Invitation { status: "invited" | "authorised" | "declined" | "revoked"; company: string; email: string; shareDetail: boolean; checkedAt: string | null; results: ListingResult[] }
const readInvitation = (j: Json | null): Invitation | null => j && typeof j.company === "string" ? {
  status: (["invited", "authorised", "declined", "revoked"].includes(String(j.status)) ? j.status : "invited") as Invitation["status"], company: j.company, email: String(j.email ?? ""),
  shareDetail: j.share_detail === true, checkedAt: typeof j.checked_at === "string" ? j.checked_at : null, results: (Array.isArray(j.results) ? (j.results as Json[]) : []).map(readResult),
} : null;

export async function viewInvitation(token: string): Promise<Invitation | "gone" | "error"> {
  const r = await post("join/view", { token }, null);
  if (r.status === 404) return "gone";
  return r.status === 200 ? (readInvitation(r.json) ?? "error") : "error";
}
export interface AuthoriseInput { fullName?: string; city?: string; phone?: string; urls: string[]; share: boolean }
export async function authorise(token: string, i: AuthoriseInput): Promise<{ results: ListingResult[]; company: string } | "revoked" | "error"> {
  const listing: Json = {};
  const sent: DataItem[] = [];
  if (i.fullName?.trim()) { listing.full_name = i.fullName.trim(); sent.push("name"); }
  if (i.city?.trim()) { listing.city_region = i.city.trim(); sent.push("city"); }
  if (i.phone?.trim()) { listing.phone = i.phone.trim(); sent.push("phone"); }
  if (i.urls.length) listing.urls = i.urls;
  const r = await post("join/authorise", { token, consent: true, share_detail: i.share, ...(Object.keys(listing).length ? { listing } : {}) }, null, sent);
  if (r.status === 409) return "revoked";
  if (r.status !== 200 || r.json?.status !== "authorised") return "error";
  return { company: String(r.json.company ?? ""), results: (Array.isArray(r.json.results) ? (r.json.results as Json[]) : []).map(readResult) };
}
export async function joinAction(kind: "decline" | "revoke" | "share", token: string, share?: boolean): Promise<boolean> {
  return (await post(`join/${kind}`, kind === "share" ? { token, share_detail: share === true } : { token }, null)).status === 200;
}
