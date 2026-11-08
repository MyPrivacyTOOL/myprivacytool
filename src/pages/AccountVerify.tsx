import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { accountsEnabled, redeemSignIn } from "@/lib/account";

// MPC-9817: the page behind the emailed link (/account/verify#t=<token>&n=<scan number>). The token sits in the fragment, so it is never sent to a server in a URL
// or written to a log. Signing in needs one deliberate press: a mail scanner or link previewer that merely opens the page changes nothing and cannot use up the link.
const params = () => new URLSearchParams(window.location.hash.replace(/^#/, ""));

const AccountVerify = () => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const token = params().get("t");
  const scan = params().get("n");

  const signIn = async () => {
    if (!token) return;
    setBusy(true); setFailed(false);
    const r = await redeemSignIn(token, scan);
    setBusy(false);
    if (r.ok) { try { history.replaceState(null, "", "/account/verify"); } catch { /* ignore */ } navigate("/account", { replace: true }); } else setFailed(true);
  };

  return (
    <>
      <Seo title="Sign in | MyPrivacyTOOL" description="Sign in to your MyPrivacyTOOL account." path="/account/verify" noindex />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
          <h1 className="mb-4 text-3xl font-bold text-foreground">Sign in</h1>
          {!accountsEnabled() ? <p className="text-muted-foreground">Accounts are not open yet.</p>
            : !token ? <p role="alert" className="text-foreground">This sign-in link is not complete. <Link to="/account" className="underline">Ask for a new one</Link>.</p>
            : (
              <div className="space-y-3">
                <p className="text-muted-foreground">Press the button to sign in to your MyPrivacyTOOL account. There is no password.</p>
                <Button onClick={signIn} disabled={busy} data-testid="signin-button">{busy ? "Signing in..." : "Sign in"}</Button>
                {failed && <p role="alert" className="text-sm text-foreground">That link has expired or was already used. <Link to="/account" className="underline">Ask for a new one</Link>.</p>}
              </div>
            )}
        </div>
      </main>
    </>
  );
};

export default AccountVerify;
