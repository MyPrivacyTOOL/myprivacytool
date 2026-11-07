// MPC-9776: free password exposure check. Browser-only; see src/lib/pwnedPassword.ts for what leaves the page (5 hash characters).
// Off unless VITE_PASSWORD_CHECK is "true". The typed password is cleared as soon as the check starts and is never stored.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trackPasswordCheckError, trackPasswordCheckScanClick, trackPasswordCheckUsed } from "@/lib/analytics";
import { checkPwnedPassword, passwordCheckEnabled, type PwnedResult } from "@/lib/pwnedPassword";

const FIX_STEPS = [
  "Change this password everywhere you have used it, starting with email and banking.",
  "Use a password manager to make a different, long password for each account.",
  "Turn on two-factor sign-in (an authenticator app is better than SMS).",
];

const PasswordCheck = () => {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PwnedResult | null>(null);

  if (!passwordCheckEnabled()) return null;

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const pw = value;
    setValue("");   // clear at once: the password lives only in this call
    if (!pw) return;
    trackPasswordCheckUsed();   // MPC-9785: a count only, no data
    setBusy(true);
    const r = await checkPwnedPassword(pw);
    if (r.status === "error") trackPasswordCheckError();
    setResult(r);
    setBusy(false);
  };

  return (
    <section className="rounded-lg border border-border p-5 text-left" data-testid="password-check" aria-labelledby="pwcheck-h">
      <h2 id="pwcheck-h" className="font-semibold text-foreground mb-1">Has your password been exposed?</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Your password never leaves your browser. We turn it into a scrambled code on your device and send only the first 5
        characters of that code to Have I Been Pwned, which cannot tell what you typed. Like any website you visit, Have I
        Been Pwned can see your IP address. We do not see, store or log your password.
      </p>
      <form onSubmit={run} className="flex gap-2">
        <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Password to check" />
        <Button type="submit" disabled={busy}>{busy ? "Checking..." : "Check"}</Button>
      </form>
      {result?.status === "checked" && result.count > 0 && (
        <div role="status" className="mt-3 text-sm">
          <p className="font-medium text-foreground">This password appeared {result.count.toLocaleString()} times in known data breaches. Do not use it.</p>
          <ul className="list-disc pl-5 mt-2 text-muted-foreground">{FIX_STEPS.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {result?.status === "checked" && result.count === 0 && (
        <p role="status" className="mt-3 text-sm text-foreground">
          Not found in known breaches. That is good, but it does not prove the password is strong or unused elsewhere. Keep it unique per account.
        </p>
      )}
      {result?.status === "checked" && (
        // MPC-9786: line approved by Chris 2026-11-07. Static link, no user data in the URL; not shown on error.
        <p className="mt-3 text-sm text-muted-foreground" data-testid="password-check-scan-link">
          Your email can be exposed too.{" "}
          <Link to="/scan?utm_source=password_check" onClick={trackPasswordCheckScanClick} className="text-brand hover:underline">
            Run the free scan to check.
          </Link>
        </p>
      )}
      {result?.status === "error" && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">We could not check right now. This is not a safe result. Please try again later.</p>
      )}
    </section>
  );
};

export default PasswordCheck;
