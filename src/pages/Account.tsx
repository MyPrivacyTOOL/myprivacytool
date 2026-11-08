import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { accountsEnabled, claimScan, deleteAccount, loadMe, issueExport, openScan, requestSignIn, signOut, type Me, type SavedHexagon } from "@/lib/account";
import { getScanNumber } from "@/lib/webScan";

// MPC-9817: the minimal account page. Email, plan (read-only), your scans (number, date, open), claim a scan by its number, sign out, and
// "delete my account and all scans" (a real delete, not an unlink). No passwords: signed out, you ask for an emailed link. Noindex.
// Off unless VITE_ACCOUNTS_ENABLED is exactly "true".
const PLAN_NAMES: Record<string, string> = { free: "Free", basic: "Basic", pro: "Pro", executive: "Executive" };

const SignedOut = ({ onSent }: { onSent: () => void }) => {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFailed(false);
    const ok = await requestSignIn(email.trim(), getScanNumber());
    setBusy(false);
    if (ok) onSent(); else setFailed(true);
  };
  return (
    <form onSubmit={submit} data-testid="signin-form" className="space-y-3">
      <p className="text-muted-foreground">Sign in or create a free account. There is no password: we email you a link.</p>
      <label htmlFor="account-email" className="block text-sm font-medium text-foreground">Email address</label>
      <input id="account-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <Button type="submit" disabled={busy || !email.trim()}>{busy ? "Sending..." : "Email me a sign-in link"}</Button>
      {failed && <p role="alert" className="text-sm text-foreground">We could not send that just now. Please check the address and try again.</p>}
    </form>
  );
};

// MPC-9818: the allowance in words. Unlimited says so and nothing more (no fair-use text); a limited plan says what is used and when it resets.
const allowanceLine = (a: NonNullable<Me["allowance"]>) => {
  if (a.limit === null) return "Unlimited scans";
  const reset = a.resetsAt ? new Date(a.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null;
  return `${a.used} of ${a.limit} used this month${reset ? `, resets ${reset}` : ""}`;
};

const ScanRow = ({ scan, canExport }: { scan: Me["scans"][number]; canExport: boolean }) => {
  const [exportMsg, setExportMsg] = useState("");
  const download = async (f: "pdf" | "json") => { setExportMsg(""); const u = await issueExport(scan.scanNumber, f); if (u) window.location.assign(u); else setExportMsg("The download could not be prepared. Try again."); };
  const [rows, setRows] = useState<SavedHexagon[] | null | "loading">(null);
  const open = async () => { setRows("loading"); setRows((await openScan(scan.scanNumber)) ?? []); };
  return (
    <li className="rounded-md border border-border p-3" data-testid="scan-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Scan {scan.scanNumber}</p>
          <p className="text-xs text-muted-foreground">{scan.createdAt ? new Date(scan.createdAt).toISOString().slice(0, 10) : ""} · {scan.hexagonCount} results</p>
        </div>
        <div className="flex gap-2">
          {rows === null && <Button variant="outline" size="sm" onClick={open}>Open</Button>}
          {canExport && <><Button variant="outline" size="sm" onClick={() => download("pdf")} data-testid="export-pdf">Download PDF</Button><Button variant="outline" size="sm" onClick={() => download("json")} data-testid="export-json">Download JSON</Button></>}
        </div>
      </div>
      {exportMsg && <p className="mt-2 text-xs text-muted-foreground" role="status">{exportMsg}</p>}
      {rows === "loading" && <p className="mt-2 text-xs text-muted-foreground">Opening...</p>}
      {Array.isArray(rows) && (rows.length ? (
        <ul className="mt-2 space-y-1 text-xs text-foreground" data-testid="scan-results">
          {rows.map((h, i) => <li key={`${h.label}-${i}`}><span className="font-medium">{h.label}</span>: {h.value}{h.confidence !== null ? ` (confidence ${h.confidence}%)` : ""}</li>)}
        </ul>
      ) : <p className="mt-2 text-xs text-muted-foreground">This scan could not be opened.</p>)}
    </li>
  );
};

const Account = () => {
  const [me, setMe] = useState<Me | "error" | null | "loading">("loading");
  const [sent, setSent] = useState(false);
  const [claim, setClaim] = useState("");
  const [claimMsg, setClaimMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const reload = async () => setMe(await loadMe());
  useEffect(() => { if (accountsEnabled()) void reload(); else setMe(null); }, []);

  const doClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await claimScan(claim);
    setClaimMsg(r === true ? "Added to your account." : r === false ? "We could not match that number to your email address." : "We could not check that just now. Please try again.");
    if (r === true) { setClaim(""); await reload(); }
  };
  const doDelete = async () => {
    setDeleting(true); setDeleteFailed(false);
    const ok = await deleteAccount();
    setDeleting(false);
    if (ok) setDeleted(true); else setDeleteFailed(true);
  };

  return (
    <>
      <Seo title="Your account | MyPrivacyTOOL" description="Your MyPrivacyTOOL account: your scans, your plan, and deleting everything." path="/account" noindex />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <h1 className="mb-6 text-3xl font-bold text-foreground">Your account</h1>
          {!accountsEnabled() && <p className="text-muted-foreground">Accounts are not open yet.</p>}
          {accountsEnabled() && deleted && <p role="status" data-testid="deleted" className="text-foreground">Your account and all your scans have been deleted. The sign-in link you used no longer works.</p>}
          {accountsEnabled() && !deleted && me === "loading" && <p className="text-muted-foreground">Loading...</p>}
          {accountsEnabled() && !deleted && me === "error" && <p role="alert" className="text-foreground">We could not load your account just now. Please refresh in a moment.</p>}
          {accountsEnabled() && !deleted && me === null && (sent
            ? <p role="status" data-testid="sent" className="text-foreground">If that address can receive email, a sign-in link is on its way. It works once. Check your inbox.</p>
            : <SignedOut onSent={() => setSent(true)} />)}
          {accountsEnabled() && !deleted && me && me !== "loading" && me !== "error" && (
            <div className="space-y-8" data-testid="account-view">
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Email</dt><dd className="text-foreground" data-testid="account-email">{me.email}</dd>
                <dt className="text-muted-foreground">Plan</dt><dd className="text-foreground" data-testid="account-plan">{PLAN_NAMES[me.plan] ?? me.plan} <Link to="/pricing" className="ml-2 text-xs underline">See plans</Link></dd>
                {me.allowance && <><dt className="text-muted-foreground">Scans</dt><dd className="text-foreground" data-testid="account-allowance">{allowanceLine(me.allowance)}</dd></>}
              </dl>
              <section aria-labelledby="scans-h">
                <h2 id="scans-h" className="mb-2 text-xl font-semibold text-foreground">Your scans</h2>
                {me.scans.length ? <ul className="space-y-2" data-testid="scan-list">{me.scans.map((s) => <ScanRow key={s.scanNumber} scan={s} canExport={me.canExport} />)}</ul>
                  : <p className="text-sm text-muted-foreground" data-testid="no-scans">No scans in this account yet.</p>}
                {me.olderKept > 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="older-kept">{me.olderKept === 1 ? "1 older scan is" : `${me.olderKept} older scans are`} saved and not deleted. Your plan lists your latest scan; a paid plan lists them all.</p>}
                <form onSubmit={doClaim} className="mt-4 flex flex-wrap items-end gap-2">
                  <div className="grow">
                    <label htmlFor="claim" className="block text-xs text-muted-foreground">Add an earlier scan by its number (it must have been requested with {me.email})</label>
                    <input id="claim" value={claim} onChange={(e) => setClaim(e.target.value)} className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                  </div>
                  <Button type="submit" variant="outline" disabled={!claim.trim()}>Add scan</Button>
                </form>
                {claimMsg && <p role="status" className="mt-2 text-xs text-foreground">{claimMsg}</p>}
              </section>
              <section aria-labelledby="del-h" className="rounded-md border border-border p-4">
                <h2 id="del-h" className="mb-1 text-lg font-semibold text-foreground">Delete my account and all scans</h2>
                <p className="mb-3 text-sm text-muted-foreground">This deletes your account and every scan saved in it, including the technical details in them. It cannot be undone.</p>
                {!confirmDelete ? <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Delete my account and all scans</Button> : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="destructive" onClick={doDelete} disabled={deleting} data-testid="confirm-delete">{deleting ? "Deleting..." : "Yes, delete everything"}</Button>
                    <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep my account</Button>
                  </div>
                )}
                {deleteFailed && <p role="alert" className="mt-2 text-sm text-foreground">We could not delete just now. Nothing has been changed. Please try again.</p>}
              </section>
              <Button variant="outline" onClick={async () => { await signOut(); setMe(null); }}>Sign out</Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default Account;
