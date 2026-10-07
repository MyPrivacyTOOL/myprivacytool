import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearSessionHint,
  fetchSession,
  hasSessionHint,
  isSignInReturn,
  setSessionHint,
  signOut,
} from "@/lib/oauthSession";

type State = { kind: "hidden" } | { kind: "connected"; email: string; expiresAt: number | null };

/**
 * "Connected as <email>" with a Sign out button (MPC-6971), as a slim strip under the header. Renders nothing
 * unless the visitor has signed in, so the public site is unchanged for everyone else and makes no extra
 * request for them. A strip (not a nav item) keeps the already full header from overflowing at any width.
 */
const SessionBadge = () => {
  const { search } = useLocation();
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isSignInReturn(search)) setSessionHint();
    if (!hasSessionHint()) {
      setState({ kind: "hidden" });
      return;
    }
    let alive = true;
    fetchSession().then((r) => {
      if (!alive) return;
      if (r.status === "connected") setState({ kind: "connected", email: r.email, expiresAt: r.expiresAt });
      else {
        // Not connected (or Worker unreachable): show nothing. Only a definite "no session" forgets the hint.
        if (r.status === "disconnected") clearSessionHint();
        setState({ kind: "hidden" });
      }
    });
    return () => {
      alive = false;
    };
  }, [search]);

  // Sessions last one hour and the browser cannot tell when they lapse, so hide the badge at expiry.
  const expiresAt = state.kind === "connected" ? state.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const id = window.setTimeout(() => {
      clearSessionHint();
      setState({ kind: "hidden" });
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [expiresAt]);

  if (state.kind !== "connected") return null;

  const onSignOut = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await signOut();
    setBusy(false);
    if (ok) {
      clearSessionHint();
      setState({ kind: "hidden" });
    } else {
      setFailed(true);
    }
  };

  return (
    <div aria-live="polite" className="border-t border-border bg-muted/40">
      <div className="container mx-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-4 py-1.5 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-foreground/80" title={state.email}>
          <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="shrink-0">Connected as</span>
          <span className="max-w-[55vw] truncate font-medium text-foreground sm:max-w-xs md:max-w-md">{state.email}</span>
        </span>
        <Button variant="outline" size="sm" className="h-7" onClick={onSignOut} disabled={busy}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {busy ? "Signing out…" : "Sign out"}
        </Button>
        {failed && (
          <span role="alert" className="text-xs text-foreground">
            Couldn't sign out. Please try again.
          </span>
        )}
      </div>
    </div>
  );
};

export default SessionBadge;
