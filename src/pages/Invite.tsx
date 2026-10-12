import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Gift, Users } from "lucide-react";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { validateEmail } from "@/lib/formFeedback";
import {
  MAX_INVITES_AT_ONCE,
  fetchReferralStatus,
  parseManageHash,
  parseReferralCode,
  referralsEnabled,
  rememberReferralCode,
  sendReferralInvites,
  type ReferralStatus,
} from "@/lib/referral";

// MPC-7645: /invite. Three views, one URL:
//  1. #c=CODE&t=TOKEN  (private link in the person's own report email): progress and the "invite up to 3 friends" form.
//  2. ?ref=CODE        (the public share link a friend receives): a plain landing that passes the code on to /scan.
//  3. neither          : explains the programme and where the person's own link is.
// Off (VITE_REFERRALS_ENABLED not "true") the route sends visitors to /scan. Draft copy for Chris to approve (docs/referral-program-mpc-7645.md).
const REWARD =
  "For every friend who gets their first privacy report, you earn one free month of Pro, up to 12 months. Pro is not on sale yet, so your months are saved on your account and start when it opens.";

type Sent = { sent: number; skipped: number } | null;

const Invite = () => {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Read the private link once, then take the token out of the address bar and the browser history entry.
  const link = useRef(parseManageHash(hash)).current;
  useEffect(() => {
    if (link) navigate({ pathname: "/invite" }, { replace: true });
  }, [link, navigate]);

  const friendCode = parseReferralCode(params.get("ref"));
  useEffect(() => {
    if (referralsEnabled() && friendCode) rememberReferralCode(friendCode);
  }, [friendCode]);

  const [status, setStatus] = useState<ReferralStatus | "invalid" | "error" | "loading">("loading");
  const [emails, setEmails] = useState<string[]>(() => Array(MAX_INVITES_AT_ONCE).fill(""));
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Sent>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (link) setStatus(await fetchReferralStatus(link));
  };
  useEffect(() => {
    if (referralsEnabled() && link) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!referralsEnabled()) return <Navigate to="/scan" replace />;

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!link || busy) return;
    const filled = emails.map((e) => e.trim()).filter(Boolean);
    if (!filled.length) return setProblem("Enter at least one friend's email address.");
    const bad = filled.map((e) => validateEmail(e)).find(Boolean);
    if (bad) return setProblem(bad);
    setProblem("");
    setBusy(true);
    const r = await sendReferralInvites(link, filled);
    setBusy(false);
    if (r.kind === "sent") {
      setResult({ sent: r.sent, skipped: r.skipped });
      setEmails(Array(MAX_INVITES_AT_ONCE).fill(""));
      void load();
    } else {
      setProblem(
        r.kind === "limit" ? "You have used all your invitations. You can still share your link yourself."
          : r.kind === "rate_limited" ? "Too many requests. Please wait a minute and try again."
          : r.kind === "invalid" ? "This link is not valid or is out of date. Use the link in your latest report email."
          : "We could not send the invitations just now. Nothing was sent. Please try again.",
      );
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const left = typeof status === "object" ? status.invites_left : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo {...pageMeta["/invite"]} path="/invite" />
      <div className="max-w-xl mx-auto px-6 py-16">
        {link ? (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-surface border border-brand/40 flex items-center justify-center">
                <Users className="text-brand" size={28} />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-center mb-3">Invite 3 friends, earn free Pro</h1>
            <p className="text-muted-foreground text-sm text-center mb-8">{REWARD}</p>

            {status === "loading" && <p className="text-center text-muted-foreground text-sm" role="status">Loading…</p>}
            {status === "invalid" && (
              <p role="alert" className="text-foreground text-sm border-l-4 border-destructive pl-3">
                This link is not valid or is out of date. Use the link in your latest report email.
              </p>
            )}
            {status === "error" && (
              <p role="alert" className="text-foreground text-sm border-l-4 border-destructive pl-3">
                We could not load your invitations just now. Please reload the page.
              </p>
            )}

            {typeof status === "object" && (
              <>
                <dl className="grid grid-cols-3 gap-3 text-center mb-8" aria-label="Your invitations">
                  {[
                    ["Signed up", status.signed_up],
                    ["Got their report", status.completed],
                    [`Free Pro months (max ${status.max_months})`, status.months_earned],
                  ].map(([label, n]) => (
                    <div key={String(label)} className="bg-card border border-border rounded-xl p-3">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-2xl font-bold text-brand">{n}</dd>
                    </div>
                  ))}
                </dl>

                <section className="mb-8">
                  <h2 className="font-semibold mb-2">Share your link</h2>
                  <div className="flex gap-2">
                    <input readOnly aria-label="Your invite link" value={status.share_url} className="flex-1 bg-background border border-surface-border rounded-lg px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" onClick={() => copy(status.share_url)} className="bg-primary text-primary-foreground text-sm font-bold px-4 rounded-lg">
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </section>

                <section>
                  <h2 className="font-semibold mb-2">Or we email them for you</h2>
                  <p className="text-muted-foreground text-xs mb-3">
                    We send each friend one plain email saying you asked us to. It does not say who you are. We keep only a scrambled (hashed) copy of their address so we never send it twice, we never email them again unless they run a scan, and they can unsubscribe. Only enter people who would not mind hearing from you. You have {left} invitation{left === 1 ? "" : "s"} left.
                  </p>
                  {result ? (
                    <p role="status" className="bg-primary/10 border border-primary/30 rounded-xl px-4 py-3 text-sm">
                      {result.sent === 0
                        ? "No emails were sent. Those addresses may already be invited, already use MyPrivacyTOOL, or have asked not to be emailed."
                        : `Sent ${result.sent} invitation${result.sent === 1 ? "" : "s"}.${result.skipped ? ` ${result.skipped} not sent (already invited, already a member, or asked not to be emailed).` : ""}`}
                    </p>
                  ) : left > 0 ? (
                    <form onSubmit={send} className="space-y-3" noValidate>
                      {emails.map((v, i) => (
                        <input
                          key={i}
                          type="email"
                          aria-label={`Friend ${i + 1} email`}
                          placeholder={`friend${i + 1}@example.com`}
                          value={v}
                          disabled={busy}
                          onChange={(e) => setEmails((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                          className="w-full bg-background border border-surface-border rounded-lg px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-brand"
                        />
                      ))}
                      {problem && <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3">{problem}</p>}
                      <button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-foreground text-sm font-bold py-3 rounded-lg">
                        {busy ? "Sending…" : "Send invitations"}
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm text-muted-foreground">You have used all your invitations. Your link above still works.</p>
                  )}
                </section>
              </>
            )}
          </>
        ) : friendCode ? (
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-surface border border-brand/40 flex items-center justify-center">
                <Gift className="text-brand" size={28} />
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-3">A friend thought you would want to see this</h1>
            <p className="text-muted-foreground text-sm mb-8">
              MyPrivacyTOOL shows you what your browser and your email address give away about you, and what to change first. It is free, and your friend does not see your results. They only find out that you finished.
            </p>
            <Link to={`/scan?ref=${friendCode}`} className="inline-block bg-primary hover:bg-primary-hover text-primary-foreground font-bold py-3 px-8 rounded-lg">
              Check my exposure →
            </Link>
          </div>
        ) : (
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-3">Invite 3 friends, earn free Pro</h1>
            <p className="text-muted-foreground text-sm mb-6">{REWARD}</p>
            <p className="text-muted-foreground text-sm mb-8">
              Your own invite link is in your privacy report email. Have not had a report yet?
            </p>
            <Link to="/scan" className="inline-block bg-primary hover:bg-primary-hover text-primary-foreground font-bold py-3 px-8 rounded-lg">
              Check my exposure →
            </Link>
          </div>
        )}

        <details className="mt-12 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">Rules</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>A friend counts when their first privacy report has been delivered to a new email address.</li>
            <li>One free month of Pro per friend, up to 12. Months are saved on your account; Pro is not on sale yet.</li>
            <li>You cannot refer yourself or an address you also own, and each friend can be referred once. We may withhold months for abuse.</li>
            <li>We never share your results with your friends, or theirs with you. See our <Link to="/privacy" className="text-brand underline">privacy policy</Link>.</li>
          </ul>
        </details>
      </div>
    </div>
  );
};

export default Invite;
