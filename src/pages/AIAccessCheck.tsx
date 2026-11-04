import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Eye, Lock, ScanLine, ShieldCheck } from "lucide-react";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import SubmitButton from "@/components/SubmitButton";
import { useLeadSubmit } from "@/hooks/useLeadSubmit";
import { suggestEmail, validateEmail } from "@/lib/formFeedback";
import {
  trackAIAccessCheckCta,
  trackAIAccessCheckSignup,
  trackAIAccessCheckView,
  trackFormSubmitError,
  trackFormValidationError,
} from "@/lib/analytics";

// HubSpot form "AI Access Check waitlist" (portal 246502821). Form GUIDs are public
// (they ship in every embed). Override per environment with VITE_HUBSPOT_AI_CHECK_FORM_ID.
// The form defines a hidden "source_tag" field, which we populate below.
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_AI_CHECK_FORM_ID || "61deaf96-7b03-474d-8285-5d0bf2da13e8";
const SOURCE_TAG = "ai-access-check";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

const CHECKS = [
  { icon: Bot, title: "Which AI systems can reach you", body: "See how AI tools, chatbots and data pipelines can identify your device and location from signals your browser already sends." },
  { icon: Eye, title: "What they can infer", body: "Your browser fingerprint, network and locale add up to a profile. We show you what that profile looks like." },
  { icon: ShieldCheck, title: "What to lock down first", body: "A short, prioritised list of fixes so you close the biggest gaps first." },
];

export default function AIAccessCheck() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [consentError, setConsentError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);
  const { status, error: errorMsg, submit } = useLeadSubmit("/thank-you?source=ai-access-check");
  const emailSuggestion = suggestEmail(email);

  const utm = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    UTM_KEYS.forEach((k) => {
      const v = p.get(k);
      if (v) out[k] = v.slice(0, 100);
    });
    return out;
  }, []);

  useEffect(() => {
    trackAIAccessCheckView(utm);
  }, [utm]);

  const scanHref = `/?${new URLSearchParams({
    utm_source: utm.utm_source || "ai-access-check",
    utm_medium: utm.utm_medium || "landing-page",
    utm_campaign: utm.utm_campaign || "mpc-6961",
  }).toString()}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading" || status === "success") return;
    const emailProblem = validateEmail(email);
    const consentProblem = consent ? "" : "Tick the box to confirm you're happy to hear from us.";
    setEmailError(emailProblem ?? "");
    setConsentError(consentProblem);
    if (emailProblem || consentProblem) {
      trackFormValidationError("ai_access_check", emailProblem ? "email" : "consent");
      (emailProblem ? emailRef.current : consentRef.current?.querySelector("input"))?.focus();
      return;
    }
    await submit(
      () =>
        submitHubSpotForm({
          formId: FORM_ID,
          fields: { email: email.trim(), source_tag: SOURCE_TAG, ...consentFields("ai_access_check") },
          pageName: "AI Access Check waitlist",
        }),
      () => trackAIAccessCheckSignup(utm),
    );
  };

  useEffect(() => {
    if (status === "error") trackFormSubmitError("ai_access_check");
  }, [status]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/ai-access-check"]} path="/ai-access-check" />
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 border border-brand/40 text-brand text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          <ScanLine size={14} /> Free · No sign-up to scan
        </div>
        <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-5">
          Are your AI tools<br />
          <span className="text-brand">reading your email?</span>
        </h1>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto leading-relaxed mb-8">
          Run the AI Access Check: in about three minutes, see what AI systems and data brokers
          can learn about you from your browser alone — no account, no personal details.
        </p>
        <Link
          to={scanHref}
          onClick={() => trackAIAccessCheckCta("hero")}
          className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white text-primary-foreground text-sm font-bold py-3.5 px-8 rounded-lg transition-colors"
        >
          <ArrowRight size={16} /> Check My Exposure
        </Link>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-14 grid gap-4 md:grid-cols-3" aria-label="What the check covers">
        {CHECKS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-surface border border-surface-border border-t-2 border-t-brand rounded-xl p-5">
            <Icon className="text-brand mb-3" size={22} />
            <h2 className="text-sm font-bold mb-2">{title}</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      <section id="waitlist" className="max-w-lg mx-auto px-6 pb-20" aria-label="Join the waitlist">
        <div className="bg-surface border border-brand/30 rounded-xl p-6">
          <h2 className="text-xl font-bold mb-2">Get the full AI Access report first</h2>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            We're building a deeper report on top of the free scan. Join the waitlist for early access.
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <label htmlFor="ai-check-email" className="sr-only">Email address</label>
            <input
              id="ai-check-email"
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              onBlur={() => email && setEmailError(validateEmail(email) ?? "")}
              placeholder="your@email.com"
              disabled={status === "loading" || status === "success"}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "ai-check-email-error" : undefined}
              className={`w-full bg-background border rounded-lg px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand disabled:opacity-50 transition-colors ${emailError ? "border-destructive" : "border-surface-border"}`}
            />
            {emailError && <p id="ai-check-email-error" role="alert" className="text-destructive text-xs">{emailError}</p>}
            {!emailError && emailSuggestion && (
              <p className="text-muted-foreground text-xs">
                Did you mean{" "}
                <button type="button" onClick={() => setEmail(emailSuggestion)} className="underline text-foreground">{emailSuggestion}</button>?
              </p>
            )}
            <div ref={consentRef}>
              <ConsentCheckbox
                id="ai-check-consent"
                checked={consent}
                onChange={(v) => {
                  setConsent(v);
                  if (v) setConsentError("");
                }}
                disabled={status === "loading" || status === "success"}
                labelClassName="text-muted-foreground"
              />
            </div>
            {consentError && <p role="alert" className="text-destructive text-xs">{consentError}</p>}
            {status === "error" && <p role="alert" className="text-destructive text-xs">{errorMsg}</p>}
            <SubmitButton
              status={status}
              loading="Joining..."
              success="You're on the list"
              className="w-full"
              idle={<><ArrowRight size={16} aria-hidden="true" /> Join the waitlist</>}
            />
            <div className="flex items-start justify-center gap-2">
              <Lock size={11} className="text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-muted-foreground text-xs">
                We'll email you about the AI Access report only. Unsubscribe anytime. See our{" "}
                <Link to="/privacy" className="underline hover:text-muted-foreground">privacy policy</Link>.
              </p>
            </div>
          </form>
        </div>
        <p className="text-muted-foreground text-xs text-center mt-8">MyPrivacyTOOL · See it. Control it. Protect it.</p>
      </section>
    </div>
  );
}
