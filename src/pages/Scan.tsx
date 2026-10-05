import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo from "@/components/Seo";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import { trackStartSignup } from "@/lib/analytics";

// Same HubSpot "Start Scan" form as /start (public form GUID, see src/pages/Start.tsx).
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_START_FORM_ID || "22ee30ae-6cf9-419b-aa46-b656b0e7b1bf";
const SOURCE_TAG = "scan-page";

// MPC-6677: scan-report Worker (confirmation email + 48h report). Unset = feature off, HubSpot-only as before.
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL as string | undefined;

async function requestScanReport(email: string): Promise<void> {
  if (!SCAN_API_URL) return;
  const q = new URLSearchParams(window.location.search);
  const res = await fetch(`${SCAN_API_URL.replace(/\/$/, "")}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      consent: true, // only called after the consent checkbox is ticked
      consent_source: "scan_page",
      utm_source: q.get("utm_source") ?? "",
      utm_medium: q.get("utm_medium") ?? "",
      utm_campaign: q.get("utm_campaign") ?? "",
      utm_content: q.get("utm_content") ?? "",
      referrer: document.referrer,
    }),
  });
  if (!res.ok) throw new Error(`scan-report ${res.status}`);
}

const Scan = () => {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !consent || submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      await submitHubSpotForm({
        formId: FORM_ID,
        fields: { email: email.trim(), source_tag: SOURCE_TAG, ...consentFields("scan_page") },
        pageName: "Free exposure scan",
      });
      try {
        await requestScanReport(email.trim());
      } catch (reportErr) {
        console.error("Scan report request failed", reportErr); // never block the HubSpot lead
      }
      trackStartSignup({ source: "scan_page" });
      setSubmitted(true);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderForm = (idSuffix: string) => (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row sm:flex-wrap gap-3 max-w-md mx-auto">
      <Input
        id={`scan-email-${idSuffix}`}
        type="email"
        aria-label="Email address"
        placeholder="Enter your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="h-12 text-base"
      />
      <Button
        type="submit"
        disabled={submitting}
        className="font-bold h-12 px-8 text-base whitespace-nowrap"
      >
        {submitting ? "Sending…" : "Start Free Scan →"}
      </Button>
      <ConsentCheckbox id={`scan-consent-${idSuffix}`} checked={consent} onChange={setConsent} disabled={submitting} />
    </form>
  );

  const thanks = (
    <div className="bg-primary/10 border border-primary/30 rounded-xl px-8 py-6 max-w-md mx-auto" role="status">
      <div className="text-primary text-2xl mb-2">✓</div>
      <p className="text-foreground font-semibold mb-1">Thanks, we have your email.</p>
      <p className="text-muted-foreground text-sm">
        We'll email <span className="text-foreground">{email}</span> with your next steps.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo title="Free Data Exposure Scan | MyPrivacyTOOL" description="Run a free scan to see what data brokers and the open internet may know about you, then get step-by-step guides to remove it." path="/scan" />
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block bg-primary/10 border border-primary/30 text-primary text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          Free · No Credit Card
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6 tracking-tight">
          Find Out What the<br />
          <span className="text-primary">Internet Knows About You</span>
        </h1>

        <p className="text-muted-foreground text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
          Data brokers and people-search sites can list your name, address and phone number without you knowing.
        </p>
        <p className="text-muted-foreground text-base mb-12 max-w-xl mx-auto">
          Run a free scan to see where your information may be listed, then follow our step-by-step guides to remove it.
        </p>

        {!submitted ? renderForm("top") : thanks}
        {errorMsg && <p role="alert" className="text-destructive text-sm mt-3">{errorMsg}</p>}

        <p className="text-muted-foreground text-xs mt-4">
          We never sell your data. Unsubscribe any time.
        </p>
      </section>

      {/* What data brokers commonly hold */}
      <section className="border-t border-border max-w-3xl mx-auto px-6 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
          What data brokers commonly list
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { icon: "🏠", title: "Home address history", desc: "Past and current addresses, often shown on people-search sites." },
            { icon: "📞", title: "Phone numbers", desc: "Current and historical numbers linked to your name." },
            { icon: "👥", title: "Family connections", desc: "Relatives and associates that sites link to your profile." },
            { icon: "📍", title: "Location clues", desc: "Where you live and work, inferred from public records." },
            { icon: "✉️", title: "Email addresses", desc: "Addresses used by marketing lists and directories." },
            { icon: "🔍", title: "Public profiles", desc: "Public social accounts that sites gather in one place." },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="flex gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
              <span className="text-2xl flex-shrink-0">{icon}</span>
              <div>
                <div className="font-semibold text-foreground text-sm mb-1">{title}</div>
                <div className="text-muted-foreground text-xs leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-muted/40 border-t border-border py-16 text-center px-6">
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Find out where you are listed.
        </h2>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Run your free scan, then use our opt-out guides to take your details down.
        </p>
        {!submitted && renderForm("bottom")}
      </section>

    </div>
  );
};

export default Scan;
