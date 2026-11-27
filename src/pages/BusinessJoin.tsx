import { useEffect, useState } from "react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { authorise, businessTeamsEnabled, joinAction, viewInvitation, type Invitation, type ListingResult } from "@/lib/businessTeam";

// MPC-9824 (F6): the employee's page, opened from the invitation email (/business/join#t=<token>). The token sits in the fragment, never in a URL sent to a server.
// Opening the page reads nothing about the person and changes nothing (a mail scanner is harmless). Pressing "Authorise" is the consent and runs the check now, on the
// pages the person pastes only. The name, city and phone typed here are used once and not stored. The person can decline, withdraw (results deleted) or change sharing.
// Off unless VITE_BUSINESS_TEAMS_ENABLED and VITE_ACCOUNTS_ENABLED are "true". Noindex.
const hashToken = () => new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t");
const stateWord = (r: ListingResult) => (r.state === "listed" ? "listed" : r.state === "not_listed" ? "not listed" : `not checked${r.notCheckedReason ? ` (${r.notCheckedReason})` : ""}`);

const Results = ({ rows }: { rows: ListingResult[] }) => (rows.length
  ? <ul className="space-y-1 text-sm" data-testid="my-results">{rows.map((r, i) => <li key={i}>{r.name ?? "Page"}: {stateWord(r)}{r.evidenceUrl ? <> · <a className="underline" href={r.evidenceUrl} rel="noopener noreferrer">evidence</a></> : null}</li>)}</ul>
  : <p className="text-sm text-muted-foreground" data-testid="no-results">No pages were checked, so there is nothing to show.</p>);

const BusinessJoin = () => {
  const token = hashToken();
  const enabled = businessTeamsEnabled();
  const [inv, setInv] = useState<Invitation | "gone" | "error" | "loading">("loading");
  const [f, setF] = useState({ name: "", city: "", phone: "", u1: "", u2: "", u3: "" });
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  const load = async () => { if (!token) { setInv("gone"); return; } setInv(await viewInvitation(token)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  useEffect(() => { if (enabled) void load(); }, [enabled]);

  const doAuthorise = async (e: React.FormEvent) => {
    e.preventDefault(); if (!token) return; setBusy(true); setMsg("");
    const r = await authorise(token, { fullName: f.name, city: f.city, phone: f.phone, urls: [f.u1, f.u2, f.u3].map((u) => u.trim()).filter(Boolean), share });
    setBusy(false);
    if (r === "revoked") { setMsg("This invitation was withdrawn. Ask your admin for a new one."); return; }
    if (r === "error") { setMsg("We could not run the check just now. Nothing was saved. Please try again."); return; }
    setF({ name: "", city: "", phone: "", u1: "", u2: "", u3: "" });
    await load();
  };
  const act = async (kind: "decline" | "revoke") => { if (!token) return; setBusy(true); const ok = await joinAction(kind, token); setBusy(false); if (ok) await load(); else setMsg("We could not do that just now. Please try again."); };
  const toggleShare = async (v: boolean) => { if (!token) return; setBusy(true); const ok = await joinAction("share", token, v); setBusy(false); if (ok) await load(); else setMsg("We could not change that just now."); };

  const input = "mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <>
      <Seo title="Team invitation | MyPrivacyTOOL" description="Your employer invited you to check your own data exposure. Nothing is checked unless you authorise it." path="/business/join" noindex />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
          <h1 className="mb-4 text-3xl font-bold text-foreground">Team invitation</h1>
          {!enabled && <p className="text-muted-foreground">Team checks are not open yet.</p>}
          {enabled && inv === "loading" && <p className="text-muted-foreground">Loading...</p>}
          {enabled && inv === "gone" && <p role="alert" data-testid="gone" className="text-foreground">This invitation link is not valid or has expired. Ask your admin to send a new one.</p>}
          {enabled && inv === "error" && <p role="alert" className="text-foreground">We could not open the invitation just now. Please refresh in a moment.</p>}
          {enabled && typeof inv === "object" && (
            <div className="space-y-6" data-testid="invitation" data-status={inv.status}>
              <p className="text-foreground"><span className="font-medium">{inv.company}</span> invited <span className="font-medium">{inv.email}</span> to a team check. Nothing about you has been looked at, and nothing will be unless you press Authorise.</p>
              {(inv.status === "invited" || inv.status === "declined") && (
                <form onSubmit={doAuthorise} className="space-y-3" data-testid="authorise-form">
                  <p className="text-sm text-muted-foreground">If you authorise, we check only the pages you show us for your own details. Your employer sees counts for the whole team, and your detail only if you tick the box below. You can withdraw any time and your results are deleted. What you type here is used for this check and not stored.</p>
                  <div><label htmlFor="j-name" className="text-sm">Your name (optional)</label><input id="j-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} /></div>
                  <div><label htmlFor="j-city" className="text-sm">Your city (optional)</label><input id="j-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} className={input} /></div>
                  <div><label htmlFor="j-phone" className="text-sm">Your phone (optional)</label><input id="j-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={input} /></div>
                  {([["u1", "A page where you may be listed (optional)"], ["u2", "A second page (optional)"], ["u3", "A third page (optional)"]] as const).map(([k, label]) => (
                    <div key={k}><label htmlFor={`j-${k}`} className="text-sm">{label}</label><input id={`j-${k}`} type="url" inputMode="url" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={input} /></div>
                  ))}
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1" data-testid="share-box" /> Share my own result detail with my admin (otherwise they only see counts)</label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy} data-testid="authorise">Authorise my check</Button>
                    {inv.status === "invited" && <Button type="button" variant="outline" disabled={busy} onClick={() => void act("decline")} data-testid="decline">No thanks</Button>}
                  </div>
                </form>
              )}
              {inv.status === "authorised" && (
                <section className="space-y-3" data-testid="authorised-view">
                  <p role="status" className="text-foreground">You authorised this check{inv.checkedAt ? ` on ${inv.checkedAt.slice(0, 10)}` : ""}. Your employer sees {inv.shareDetail ? "your result detail and the team counts" : "counts only, not your detail"}.</p>
                  <Results rows={inv.results} />
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={inv.shareDetail} disabled={busy} onChange={(e) => void toggleShare(e.target.checked)} className="mt-1" data-testid="share-toggle" /> Share my result detail with my admin</label>
                  <Button variant="destructive" disabled={busy} onClick={() => void act("revoke")} data-testid="revoke">Withdraw and delete my results</Button>
                </section>
              )}
              {inv.status === "declined" && <p className="text-sm text-muted-foreground" data-testid="declined">You declined. Nothing was checked. You can still change your mind above.</p>}
              {inv.status === "revoked" && <p role="status" data-testid="revoked" className="text-foreground">You withdrew. Your results were deleted and nothing further will be checked. Ask your admin for a new invitation if you change your mind.</p>}
              {msg && <p role="alert" className="text-sm text-foreground">{msg}</p>}
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default BusinessJoin;
