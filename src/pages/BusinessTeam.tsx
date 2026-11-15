import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { accountsEnabled, requestSignIn } from "@/lib/account";
import { businessTeamsEnabled, createTeam, deleteTeam, inviteEmails, loadTeam, removeMember, type TeamSummary } from "@/lib/businessTeam";

// MPC-9824 (F6): the admin's team page. Sign-in required (the same emailed-link account as /account). The summary is COUNTS for the people who authorised;
// a person's own detail appears only where that person ticked "share with my admin". Invited-but-not-authorised people have no results at all.
// Off unless VITE_BUSINESS_TEAMS_ENABLED and VITE_ACCOUNTS_ENABLED are "true". Noindex.
const STATUS_WORDS: Record<string, string> = { invited: "Invited, not yet authorised", authorised: "Authorised", declined: "Declined", revoked: "Withdrew" };

const SignIn = () => {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [failed, setFailed] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setFailed(false); if (await requestSignIn(email.trim(), null)) setSent(true); else setFailed(true); };
  if (sent) return <p role="status" data-testid="sent" className="text-foreground">If that address can receive email, a sign-in link is on its way. It works once. Come back to this page after you sign in.</p>;
  return (
    <form onSubmit={submit} data-testid="team-signin" className="space-y-3">
      <p className="text-muted-foreground">Sign in with your work email to run a team check. There is no password: we email you a link.</p>
      <label htmlFor="team-admin-email" className="block text-sm font-medium text-foreground">Work email</label>
      <input id="team-admin-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <Button type="submit" disabled={!email.trim()}>Email me a sign-in link</Button>
      {failed && <p role="alert" className="text-sm text-foreground">We could not send that just now. Please check the address and try again.</p>}
    </form>
  );
};

const BusinessTeam = () => {
  const enabled = businessTeamsEnabled() && accountsEnabled();
  const [state, setState] = useState<"loading" | "signed_out" | "error" | "ready">("loading");
  const [teams, setTeams] = useState<{ teamId: string; company: string }[]>([]);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [company, setCompany] = useState(""); const [emails, setEmails] = useState(""); const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = async (teamId?: string) => {
    const r = await loadTeam(teamId);
    if (r === "signed_out" || r === "error") { setState(r); return; }
    setTeams(r.teams); setSummary(r.summary); setState("ready");
  };
  useEffect(() => { if (enabled) void reload(); }, [enabled]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg("");
    const r = await createTeam(company.trim());
    if (typeof r === "object") { setCompany(""); await reload(r.teamId); } else setMsg(r === "limit" ? "You have reached the team limit." : "We could not create the team just now. Please try again.");
  };
  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); if (!summary) return; setMsg("");
    const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const r = await inviteEmails(summary.teamId, list);
    if (r === "error") { setMsg("We could not send the invitations. Check the addresses and try again."); return; }
    setEmails(""); setMsg(`${r.invited} invited, ${r.sent} email${r.sent === 1 ? "" : "s"} sent${r.skipped ? `, ${r.skipped} already on the team` : ""}.`);
    await reload(summary.teamId);
  };
  const remove = async (id: string) => { if (summary && (await removeMember(summary.teamId, id))) await reload(summary.teamId); else setMsg("We could not remove that person just now."); };
  const del = async () => { if (summary && (await deleteTeam(summary.teamId))) { setConfirmDelete(false); setMsg("The team and every result in it were deleted."); await reload(); } else setMsg("We could not delete the team just now. Nothing was changed."); };

  const a = summary?.aggregate; const c = summary?.counts;
  return (
    <>
      <Seo title="Your team check | MyPrivacyTOOL" description="Invite your team to check their own data exposure. Each person authorises their own check." path="/business/team" noindex />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="mb-2 text-3xl font-bold text-foreground">Your team check</h1>
          <p className="mb-6 text-sm text-muted-foreground">Each person authorises their own check. You see counts for the people who said yes, and a person's detail only if they choose to share it. <Link to="/business" className="underline">Back to Business</Link></p>
          {!enabled && <p className="text-muted-foreground">Team checks are not open yet.</p>}
          {enabled && state === "loading" && <p className="text-muted-foreground">Loading...</p>}
          {enabled && state === "error" && <p role="alert" className="text-foreground">We could not load your team just now. Please refresh in a moment.</p>}
          {enabled && state === "signed_out" && <SignIn />}
          {enabled && state === "ready" && (
            <div className="space-y-8" data-testid="team-view">
              {teams.length > 1 && <div className="flex flex-wrap gap-2">{teams.map((t) => <Button key={t.teamId} size="sm" variant={t.teamId === summary?.teamId ? "default" : "outline"} onClick={() => void reload(t.teamId)}>{t.company}</Button>)}</div>}
              {!summary && (
                <form onSubmit={create} data-testid="create-team" className="space-y-3">
                  <label htmlFor="team-company" className="block text-sm font-medium text-foreground">Company name</label>
                  <input id="team-company" required value={company} onChange={(e) => setCompany(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                  <Button type="submit" disabled={!company.trim()}>Create team</Button>
                </form>
              )}
              {summary && a && c && (
                <>
                  <section aria-labelledby="sum-h" data-testid="summary">
                    <h2 id="sum-h" className="mb-2 text-xl font-semibold text-foreground">{summary.company}: team summary</h2>
                    <dl className="grid grid-cols-[14rem_1fr] gap-y-1 text-sm">
                      <dt className="text-muted-foreground">People invited</dt><dd data-testid="n-invited">{c.invitedTotal}</dd>
                      <dt className="text-muted-foreground">Authorised (included below)</dt><dd data-testid="n-authorised">{c.authorised}</dd>
                      <dt className="text-muted-foreground">Waiting for an answer</dt><dd data-testid="n-awaiting">{c.awaiting}</dd>
                      <dt className="text-muted-foreground">People with a listing found</dt><dd data-testid="n-with-listing">{a.peopleWithListing}</dd>
                      <dt className="text-muted-foreground">Pages checked / listed / not listed / not checked</dt><dd data-testid="n-pages">{a.pagesChecked} / <span data-testid="n-listed">{a.listed}</span> / {a.notListed} / {a.notChecked}</dd>
                    </dl>
                    <p className="mt-2 text-xs text-muted-foreground">Counts cover only people who pressed Authorise. Nothing is read about anyone else.</p>
                  </section>
                  <section aria-labelledby="people-h">
                    <h2 id="people-h" className="mb-2 text-xl font-semibold text-foreground">People</h2>
                    {summary.members.length === 0 ? <p className="text-sm text-muted-foreground">No one invited yet.</p> : (
                      <ul className="space-y-2" data-testid="members">
                        {summary.members.map((m) => (
                          <li key={m.memberId ?? m.email} className="rounded-md border border-border p-3 text-sm" data-testid="member-row">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span><span className="font-medium text-foreground">{m.email}</span> <span className="text-muted-foreground">· {STATUS_WORDS[m.status]}{m.status === "authorised" && !m.shared ? " · detail not shared" : ""}</span></span>
                              {m.memberId && <Button size="sm" variant="outline" onClick={() => void remove(m.memberId!)}>Remove</Button>}
                            </div>
                            {m.detail && m.detail.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs text-foreground" data-testid="member-detail">
                                {m.detail.map((d, i) => <li key={i}>{d.name ?? "Page"}: {d.state === "listed" ? "listed" : d.state === "not_listed" ? "not listed" : `not checked${d.notCheckedReason ? ` (${d.notCheckedReason})` : ""}`}</li>)}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <form onSubmit={invite} data-testid="invite-form" className="space-y-2">
                    <label htmlFor="team-emails" className="block text-sm font-medium text-foreground">Invite by email (one or more, separated by commas or new lines)</label>
                    <textarea id="team-emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                    <Button type="submit" disabled={!emails.trim()}>Send invitations</Button>
                  </form>
                  <section aria-labelledby="del-h" className="rounded-md border border-border p-4">
                    <h2 id="del-h" className="mb-1 text-lg font-semibold text-foreground">Delete this team</h2>
                    <p className="mb-3 text-sm text-muted-foreground">Deletes the team, every invitation and every result. It cannot be undone.</p>
                    {!confirmDelete ? <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Delete this team</Button> : (
                      <div className="flex gap-2"><Button variant="destructive" onClick={del} data-testid="confirm-delete-team">Yes, delete the team</Button><Button variant="outline" onClick={() => setConfirmDelete(false)}>Keep it</Button></div>
                    )}
                  </section>
                </>
              )}
              {msg && <p role="status" data-testid="team-msg" className="text-sm text-foreground">{msg}</p>}
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default BusinessTeam;
