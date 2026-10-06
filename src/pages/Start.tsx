import { useEffect, useRef, useState } from "react";
import { Shield, Eye, MapPin, Phone, Mail, Globe, Database, ArrowRight, Check, X, MessageCircle, Send, MessageSquare, Instagram } from "lucide-react";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import SubmitButton from "@/components/SubmitButton";
import { useExperiment } from "@/hooks/useExperiment";
import { useLeadSubmit } from "@/hooks/useLeadSubmit";
import { suggestEmail, validateEmail } from "@/lib/formFeedback";
import {
  trackExperimentCta,
  trackExperimentExposure,
  trackFormSubmitError,
  trackFormValidationError,
  trackStartSignup,
} from "@/lib/analytics";

// HubSpot form "Start Scan" (portal 246502821). Form GUIDs are public (they ship in every
// embed). Override per environment with VITE_HUBSPOT_START_FORM_ID. The form defines a hidden
// "source_tag" field, which we also send explicitly below.
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_START_FORM_ID || "22ee30ae-6cf9-419b-aa46-b656b0e7b1bf";
const SOURCE_TAG = "start-scan";

const hexagonData = [
  { icon: Eye, label: "Name", value: "Detected from your profile", color: "hsl(var(--brand-green))" },
  { icon: MapPin, label: "Location", value: "City & country visible", color: "hsl(var(--brand-green-hover))" },
  { icon: Phone, label: "Phone", value: "Checking public records...", color: "hsl(var(--brand-green))" },
  { icon: Mail, label: "Email", value: "Associated addresses found", color: "hsl(var(--brand-green-hover))" },
  { icon: Globe, label: "Social Profiles", value: "Multiple platforms linked", color: "hsl(var(--brand-green))" },
  { icon: Database, label: "Data Broker Exposure", value: "Estimated 40+ sites", color: "hsl(var(--brand-green-hover))" },
];

// MPC-7400 A/B test: submit-button copy. The first entry is the control and matches the pre-test copy.
const CTA_LABEL: Record<string, string> = {
  control: "Check My Exposure",
  early_access: "Get early access, free",
};

const channels = [
  { name: "WhatsApp", Icon: MessageCircle, url: "https://wa.me/YOUR_WHATSAPP_NUMBER?text=scan+me" },
  { name: "Telegram", Icon: Send, url: "https://t.me/MyPrivacyToolBot?start=scan" },
  { name: "Messenger", Icon: MessageSquare, url: "https://m.me/myprivacytool" },
  { name: "Instagram", Icon: Instagram, url: "https://ig.me/m/myprivacytool" },
  { name: "Email", Icon: Mail, url: "mailto:scan@myprivacytool.io?subject=Scan%20Me" },
];

export default function Start() {
  const [confirmed, setConfirmed] = useState<null | boolean>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [consentError, setConsentError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);
  const exposureTracked = useRef(false);

  const { variantId, forced } = useExperiment("start_cta");
  const { status, error: errorMsg, submit } = useLeadSubmit("/thank-you?source=start", { variant: variantId });
  const sending = status === "loading" || status === "success";
  const emailSuggestion = suggestEmail(email);

  const handleConfirm = (yes: boolean) => {
    setConfirmed(yes);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  // Exposure = the moment the button under test becomes visible, not page load.
  useEffect(() => {
    if (confirmed === true && !exposureTracked.current) {
      exposureTracked.current = true;
      trackExperimentExposure("start_cta", variantId, forced);
    }
  }, [confirmed, variantId, forced]);

  // Move keyboard focus into the email field once the form appears.
  useEffect(() => {
    if (confirmed === true) emailRef.current?.focus({ preventScroll: true });
  }, [confirmed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const emailProblem = validateEmail(email);
    const consentProblem = consent ? "" : "Tick the box to confirm you're happy to hear from us.";
    setEmailError(emailProblem ?? "");
    setConsentError(consentProblem);
    if (emailProblem || consentProblem) {
      trackFormValidationError("start_scan", emailProblem ? "email" : "consent");
      (emailProblem ? emailRef.current : consentRef.current?.querySelector("input"))?.focus();
      return;
    }
    trackExperimentCta("start_cta", variantId, forced);
    await submit(
      () =>
        submitHubSpotForm({
          formId: FORM_ID,
          fields: { email: email.trim(), source_tag: SOURCE_TAG, ...consentFields("start_page") },
          pageName: "Start scan",
        }),
      () => trackStartSignup({ source: "start_page", experiment_id: "start_cta", variant_id: variantId }),
    );
  };

  useEffect(() => {
    if (status === "error") trackFormSubmitError("start_scan");
  }, [status]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo {...pageMeta["/start"]} path="/start" />
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <Shield className="text-brand" size={20} />
        <span className="text-brand text-sm font-bold tracking-widest uppercase">MyPrivacyTOOL</span>
        <span className="text-muted-foreground text-xs ml-auto">Free Privacy Exposure Check</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Intro */}
        <div className="mb-10">
          <p className="text-muted-foreground text-xs tracking-widest uppercase mb-3">What we know about you right now</p>
          <h1 className="text-3xl font-bold text-foreground mb-4 leading-tight">
            Your data is everywhere.<br />
            <span className="text-brand">See where. Take it back.</span>
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Based on publicly available data and data broker records, here is what anyone can find about you today, so you can see your footprint and take control of it.
          </p>
        </div>

        {/* Hexagon Grid */}
        <div className="grid grid-cols-1 gap-3 mb-10">
          {hexagonData.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-4 bg-card border border-border rounded-lg px-5 py-4"
              style={{ borderLeftColor: item.color, borderLeftWidth: 3 }}
            >
              <item.icon size={18} style={{ color: item.color }} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">{item.label}</p>
                <p className="text-sm text-foreground font-mono">{item.value}</p>
              </div>
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: item.color }} />
            </div>
          ))}
        </div>

        {/* Confirmation prompt */}
        {confirmed === null && (
          <div className="bg-card border border-border rounded-xl p-6 mb-8">
            <p className="text-foreground text-sm mb-2 font-semibold">Is this data about you?</p>
            <p className="text-muted-foreground text-xs mb-6">
              Confirm, then join the list and we'll email you when your free privacy report is ready.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleConfirm(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white text-primary-foreground text-sm font-bold py-3 px-6 rounded-lg transition-colors"
              >
                <Check size={16} />
                Yes, that's me
              </button>
              <button
                onClick={() => handleConfirm(false)}
                className="flex-1 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground text-sm font-bold py-3 px-6 rounded-lg transition-colors"
              >
                <X size={16} />
                Not me
              </button>
            </div>
          </div>
        )}

        {/* Y — confirmed. Success redirects to /thank-you (see useLeadSubmit). */}
        {confirmed === true && (
          <div className="bg-primary/5 border border-primary/30 rounded-xl p-6 mb-8 motion-safe:animate-fade-in">
            <p className="text-brand text-sm font-semibold mb-1">Confirmed.</p>
            <p className="text-muted-foreground text-xs mb-5">
              Enter your email and we'll let you know as soon as your free privacy report is ready.
            </p>
            <form onSubmit={handleSubmit} noValidate className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label htmlFor="start-email" className="sr-only">Email address</label>
                  <input
                    id="start-email"
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
                    disabled={sending}
                    aria-invalid={emailError ? true : undefined}
                    aria-describedby={emailError ? "start-email-error" : undefined}
                    className={`w-full bg-background border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-60 ${emailError ? "border-destructive" : "border-input"}`}
                  />
                </div>
                <SubmitButton
                  status={status}
                  loading="Sending..."
                  success="You're in"
                  idle={<><ArrowRight size={16} aria-hidden="true" />{CTA_LABEL[variantId] ?? CTA_LABEL.control}</>}
                />
              </div>
              {emailError && (
                <p id="start-email-error" role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3">{emailError}</p>
              )}
              {!emailError && emailSuggestion && (
                <p className="text-muted-foreground text-xs">
                  Did you mean{" "}
                  <button type="button" onClick={() => setEmail(emailSuggestion)} className="underline text-foreground">
                    {emailSuggestion}
                  </button>
                  ?
                </p>
              )}
              <div ref={consentRef}>
                <ConsentCheckbox
                  id="start-consent"
                  checked={consent}
                  onChange={(v) => {
                    setConsent(v);
                    if (v) setConsentError("");
                  }}
                  disabled={sending}
                  labelClassName="text-muted-foreground"
                />
              </div>
              {consentError && (
                <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3">{consentError}</p>
              )}
            </form>
            {errorMsg && <p role="alert" className="text-foreground text-xs mt-3 border-l-4 border-destructive pl-3">{errorMsg}</p>}
          </div>
        )}

        {/* N — not me */}
        {confirmed === false && (
          <div className="bg-card border border-border rounded-xl p-6 mb-8 animate-fade-in">
            <p className="text-foreground font-semibold mb-1">Let's find the right profile.</p>
            <p className="text-muted-foreground text-xs mb-4">
              No problem — enter your name and we'll run a fresh scan specifically for you.
            </p>
            <a
              href="/scan"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white text-primary-foreground text-sm font-bold py-3 px-6 rounded-lg transition-colors"
            >
              <ArrowRight size={16} />
              Check My Exposure
            </a>
          </div>
        )}

        {/* Channel CTAs */}
        <div className="border-t border-border pt-8">
          <p className="text-muted-foreground text-xs uppercase tracking-widest mb-4 text-center">Or message us directly on any platform</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {channels.map((ch) => (
              <a
                key={ch.name}
                href={ch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-card hover:bg-muted border border-border rounded-lg px-4 py-3 transition-colors group"
              >
                <ch.Icon size={18} className="text-brand shrink-0" aria-hidden="true" />
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{ch.name}</span>
              </a>
            ))}
          </div>
          <p className="text-muted-foreground text-xs text-center mt-4">
            Send any message to get your First Hexagon report instantly
          </p>
        </div>
      </div>
    </div>
  );
}
