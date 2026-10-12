import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, MailX } from "lucide-react";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { validateEmail } from "@/lib/formFeedback";

// "Unsubscribe me" page. Two ways in:
//  1. From a link in one of our emails (?e=<address>&t=<signed token>): shows a confirm button, and the opt-out happens
//     only when it is pressed, because mail scanners open links automatically.
//  2. From the footer: the visitor types their address and we email a confirmation link to it, so only the owner of the
//     address can opt out. The answer is the same whether or not the address is on our list.
// Both talk to the scan-report Worker, the same service the /scan page uses.
const API = ((import.meta.env.VITE_SCAN_API_URL as string | undefined) ?? "https://mpt-scan-report.myprivacytool.workers.dev").replace(/\/$/, "");

type Status = "idle" | "loading" | "done" | "sent" | "invalid" | "limited" | "error";

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const e = params.get("e") ?? "";
  const t = params.get("t") ?? "";
  const hasLink = Boolean(e && t);
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");

  const confirm = async () => {
    if (status === "loading") return;
    setStatus("loading");
    try {
      const res = await fetch(`${API}/api/unsubscribe?e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      setStatus(res.ok ? "done" : res.status === 400 ? "invalid" : "error");
    } catch {
      setStatus("error");
    }
  };

  const requestLink = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (status === "loading") return;
    const problem = validateEmail(email);
    setEmailError(problem ?? "");
    if (problem) return;
    setStatus("loading");
    try {
      const res = await fetch(`${API}/api/unsubscribe-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setStatus(res.ok ? "sent" : res.status === 429 ? "limited" : "error");
    } catch {
      setStatus("error");
    }
  };

  const showForm = !hasLink || status === "invalid";
  const loading = status === "loading";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo {...pageMeta["/unsubscribe"]} path="/unsubscribe" />
      <div className="max-w-lg mx-auto px-6 py-16">
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-full bg-surface border border-brand/40 flex items-center justify-center">
            <MailX className="text-brand" size={28} />
          </div>
        </div>

        {status === "done" ? (
          <div className="bg-surface border border-brand/40 rounded-xl p-6 text-center" role="status">
            <div className="w-12 h-12 rounded-full bg-background border border-brand flex items-center justify-center mx-auto mb-4">
              <Check className="text-brand" size={22} />
            </div>
            <h1 className="text-brand font-semibold text-xl mb-2">You are unsubscribed.</h1>
            <p className="text-muted-foreground text-sm">
              We will send you no more scan report or follow-up emails.
            </p>
          </div>
        ) : status === "sent" ? (
          <div className="bg-surface border border-brand/40 rounded-xl p-6 text-center" role="status">
            <h1 className="text-brand font-semibold text-xl mb-2">Check your inbox.</h1>
            <p className="text-muted-foreground text-sm">
              If that address is on our list, we have emailed it a confirmation link. Open the link and press the button to finish. Nothing changes until you do.
              Check your spam folder if it does not arrive within a few minutes.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-foreground mb-3 leading-tight">Unsubscribe from MyPrivacyTOOL emails</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {hasLink && status !== "invalid"
                  ? "Fixed what was in your report? Then you do not need to hear from us again. Confirm below and we will send you no more scan report or follow-up emails."
                  : "Enter the address you used for your scan. We will email it a confirmation link, so only you can unsubscribe it."}
              </p>
            </div>

            {status === "invalid" && (
              <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3 mb-6">
                That link is not valid or is out of date. Request a new one below.
              </p>
            )}

            {hasLink && status !== "invalid" ? (
              <button
                type="button"
                onClick={confirm}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white disabled:opacity-60 text-primary-foreground text-sm font-bold py-3.5 px-6 rounded-lg transition-colors"
              >
                {loading ? <span className="animate-pulse">Unsubscribing...</span> : "Yes, unsubscribe me"}
              </button>
            ) : (
              showForm && (
                <form onSubmit={requestLink} className="space-y-4" noValidate>
                  <label htmlFor="unsubscribe-email" className="sr-only">Email address</label>
                  <input
                    id="unsubscribe-email"
                    type="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="your@email.com"
                    disabled={loading}
                    aria-invalid={emailError ? true : undefined}
                    className="w-full bg-background border border-surface-border rounded-lg px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand disabled:opacity-50"
                  />
                  {emailError && <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3">{emailError}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white disabled:opacity-60 text-primary-foreground text-sm font-bold py-3.5 px-6 rounded-lg transition-colors"
                  >
                    {loading ? <span className="animate-pulse">Sending...</span> : "Email me a confirmation link"}
                  </button>
                </form>
              )
            )}

            {status === "limited" && (
              <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3 mt-4">Too many requests. Please wait a minute and try again.</p>
            )}
            {status === "error" && (
              <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3 mt-4">
                Something went wrong. Please try again, or email hello@myprivacytool.io and we will remove you by hand.
              </p>
            )}
          </>
        )}

        <p className="text-muted-foreground text-xs leading-relaxed text-center mt-10">
          This stops our scan report and follow-up emails. To leave any other list, or to have your data deleted, write to{" "}
          <a href="mailto:privacy@myprivacytool.io" className="underline hover:text-foreground">privacy@myprivacytool.io</a>. See our{" "}
          <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
};

export default Unsubscribe;
