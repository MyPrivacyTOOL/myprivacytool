import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearSessionHint,
  fetchSession,
  hasSessionHint,
  parseSignInReturn,
  setSessionHint,
  signOut,
  stripSignInParams,
} from "@/lib/oauthSession";

type State = { kind: "hidden" } | { kind: "connected"; email: string; expiresAt: number | null };

/**
 * "Connected as <email>" with a Sign out button (MPC-6971), as a slim strip under the header. Renders nothing
 * unless the visitor has signed in, so the public site is unchanged for everyone else and makes no extra
 * request for them. A strip (not a nav item) keeps the already full header from overflowing at any width.
 * A failed sign-in shows a dismissible message in the same place.
 */
const SessionBadge = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // The Worker sends the browser back with ?channel=google, so this runs once per full page load. Keep the URL
  // the component mounted with, and the latest navigate, in refs so this effect does not re-run on every route change.
  const mountedAt = useRef(location);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const { pathname, search, hash } = mountedAt.current;
    const back = parseSignInReturn(search);
    if (back) {
      if (back.kind === "success") setSessionHint();
      else setNotice(back.message);
      // Tidy the address bar so a reload or a shared link doesn't replay the sign-in marker.
      navigateRef.current({ pathname, search: stripSignInParams(search), hash }, { replace: true });
    }
    if (!hasSessionHint()) return;
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
  }, []);

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

  if (state.kind !== "connected") {
    if (!notice) return null;
    return (
      <div className="border-t border-border bg-muted/40">
        <div className="container mx-auto flex items-center justify-end gap-3 px-4 py-1.5 text-sm">
          <p role="alert" className="text-foreground">
            {notice}
          </p>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

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
