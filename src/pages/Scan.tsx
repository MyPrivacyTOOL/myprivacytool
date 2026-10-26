import { useEffect, useRef, useState } from "react";
import { Home, Phone, Users, MapPin, Mail, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import SaveScanConsentCheckbox from "@/components/SaveScanConsentCheckbox";
import RecogniseConsentCheckbox from "@/components/RecogniseConsentCheckbox";
import ScanSavingNotice from "@/components/ScanSavingNotice";
import TurnstileBox from "@/components/TurnstileBox";
import { SCAN_TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import LiveScanPanel from "@/components/LiveScanPanel";
import ScanNumberNotice from "@/components/ScanNumberNotice";
import { trackStartSignup, trackReportRequested, trackReportFailed } from "@/lib/analytics";
import { canOfferScanSave, recognitionEnabled, reportStep } from "@/lib/webScan";
import { referralsEnabled, rememberReferralCode } from "@/lib/referral";
import { ReportRequestError, REPORT_FAILED_MESSAGE, REPORT_WAIT_MESSAGE, requestScanReport } from "@/lib/scanReport";

// Same HubSpot "Start Scan" form as /start (public form GUID, see src/pages/Start.tsx).
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_START_FORM_ID || "22ee30ae-6cf9-419b-aa46-b656b0e7b1bf";
const SOURCE_TAG = "scan-page";

const Scan = () => {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  // MPC-7470: the save box exists only while saving is on AND this browser holds a finished scan (the visitor ran the scan on the home page).
  const [offerSave] = useState(() => canOfferScanSave());
  const [saveConsent, setSaveConsent] = useState(false);
  // MPC-7494: a second, separate, optional box, only while recognition is on; ticking it needs the save box ticked first.
  const [offerRecognise] = useState(() => canOfferScanSave() && recognitionEnabled());
  const [recogniseConsent, setRecogniseConsent] = useState(false);
  const onSaveChange = (v: boolean) => {
    setSaveConsent(v);
    if (!v) setRecogniseConsent(false);   // un-ticking the save box withdraws the recognise tick
  };
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // MPC-7535: on a retry after a failed report request the HubSpot lead is not sent a second time.
  const hubspotSent = useRef(false);
  // MPC-8430: Turnstile token for the report request. A blocked script means no widget, and the form still submits (the Worker decides).
  const [tsToken, setTsToken] = useState("");
  const [tsReset, setTsReset] = useState(0);
  const tsWidgets = useRef(0);
  // The visitor pressed the button before Cloudflare finished: the request is sent by itself the moment the token arrives (no "try again" round trip).
  const [waitingForToken, setWaitingForToken] = useState(false);
  // MPC-8452: key for the live results shown under the thank-you (memory only: a refresh starts again)
  const [liveToken, setLiveToken] = useState("");

  // MPC-7493: the contact step was opened. Under D12 (MPC-7470) a scan is saved only at the contact step, so this sends nothing unless this visit
  // already saved a scan; the drop-off before it is read from the GA4 events.
  useEffect(() => {
    reportStep("contact_step_opened");
    // MPC-7645: a visitor who came from a friend's link may go and run the scan on the home page first; keep the code for this visit.
    if (referralsEnabled()) rememberReferralCode(new URLSearchParams(window.location.search).get("ref"));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // The save box is optional: unticked = the report is still requested, the scan is just not saved.
    if (!email.trim() || !consent || submitting || waitingForToken) return;
    if (tsWidgets.current > 0 && !tsToken) {
      setErrorMsg("");
      setWaitingForToken(true);
      return;
    }
    void sendReport(tsToken);
  };

  const sendReport = async (token: string) => {
    setSubmitting(true);
    setErrorMsg("");
    try {
      if (!hubspotSent.current) {
        await submitHubSpotForm({
          formId: FORM_ID,
          fields: { email: email.trim(), source_tag: SOURCE_TAG, ...consentFields("scan_page") },
          pageName: "Free exposure scan",
        });
        hubspotSent.current = true; // the lead is kept whatever happens to the report request
      }
      let sent: { liveToken?: string } = {};
      try {
        sent = await requestScanReport(email.trim(), offerSave && saveConsent, offerSave && saveConsent && offerRecognise && recogniseConsent, token);
      } catch (reportErr) {
        const kind = reportErr instanceof ReportRequestError ? reportErr.kind : "network";
        const status = reportErr instanceof ReportRequestError ? reportErr.status : 0;
        console.error("Scan report request failed", kind, status);
        trackReportFailed("scan_page", kind, status);
        setErrorMsg(kind === "rate_limited" ? REPORT_WAIT_MESSAGE : REPORT_FAILED_MESSAGE); // no thank-you screen: the email stays in the box for a retry
        setTsToken(""); // a Turnstile token is single use: get a fresh one for the retry
        setTsReset((n) => n + 1);
        return;
      }
      if (sent.liveToken) setLiveToken(sent.liveToken);
      trackReportRequested("scan_page", offerSave && saveConsent);
      trackStartSignup({ source: "scan_page" });
      setSubmitted(true);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (waitingForToken && tsToken) {
      setWaitingForToken(false);
      void sendReport(tsToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForToken, tsToken]);

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
        disabled={submitting || waitingForToken}
        className="font-bold h-12 px-8 text-base whitespace-nowrap"
      >
        {submitting ? "Sending…" : waitingForToken ? "Verifying…" : "Check My Exposure →"}
      </Button>
      <TurnstileBox
        sitekey={SCAN_TURNSTILE_SITE_KEY}
        onToken={setTsToken}
        onRendered={(on) => { tsWidgets.current += on ? 1 : -1; }}
        resetSignal={tsReset}
      />
      <ConsentCheckbox id={`scan-consent-${idSuffix}`} checked={consent} onChange={setConsent} disabled={submitting} />
      {offerSave && (
        <>
          <SaveScanConsentCheckbox id={`scan-save-consent-${idSuffix}`} checked={saveConsent} onChange={onSaveChange} disabled={submitting} />
          {offerRecognise && (
            <RecogniseConsentCheckbox id={`scan-recognise-consent-${idSuffix}`} checked={recogniseConsent} onChange={setRecogniseConsent} disabled={submitting || !saveConsent} />
          )}
          <ScanSavingNotice variant="contact" />
        </>
      )}
    </form>
  );

  const thanks = (
    <div className="bg-primary/10 border border-primary/30 rounded-xl px-8 py-6 max-w-md mx-auto" role="status">
      <div className="text-brand text-2xl mb-2">✓</div>
      <p className="text-foreground font-semibold mb-1">Thanks, we have your email.</p>
      <p className="text-muted-foreground text-sm">
        We'll email <span className="text-foreground">{email}</span> with your next steps.
      </p>
      <ScanNumberNotice />
      {liveToken && <LiveScanPanel token={liveToken} />}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo {...pageMeta["/scan"]} path="/scan" />
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block bg-primary/10 border border-primary/30 text-foreground text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          Free · No Credit Card
        </div>

        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6 tracking-tight">
          Find Out What the<br />
          <span className="text-brand">Internet Knows About You</span>
        </h1>

        <p className="text-muted-foreground text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
          Data brokers and people-search sites can list your name, address and phone number without you knowing.
        </p>
        <p className="text-muted-foreground text-base mb-12 max-w-xl mx-auto">
          Check your exposure to see where your information may be listed, then follow our step-by-step guides to remove it.
        </p>

        {!submitted ? renderForm("top") : thanks}
        {waitingForToken && <p role="status" className="text-muted-foreground text-sm mt-3 text-left">Verifying you are human, this takes a moment. Your request is sent automatically as soon as it is done. If a box appears, please tick it.</p>}
        {errorMsg && <p role="alert" className="text-foreground text-sm mt-3 border-l-4 border-destructive pl-3 text-left">{errorMsg}</p>}

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
            { Icon: Home, title: "Home address history", desc: "Past and current addresses, often shown on people-search sites." },
            { Icon: Phone, title: "Phone numbers", desc: "Current and historical numbers linked to your name." },
            { Icon: Users, title: "Family connections", desc: "Relatives and associates that sites link to your profile." },
            { Icon: MapPin, title: "Location clues", desc: "Where you live and work, inferred from public records." },
            { Icon: Mail, title: "Email addresses", desc: "Addresses used by marketing lists and directories." },
            { Icon: Search, title: "Public profiles", desc: "Public social accounts that sites gather in one place." },
          ].map(({ Icon, title, desc }) => (
            <div key={title} className="flex gap-4 p-4 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
              <Icon className="w-6 h-6 text-brand flex-shrink-0" aria-hidden="true" />
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
          Check your exposure, then use our opt-out guides to take your details down.
        </p>
        {!submitted && renderForm("bottom")}
      </section>

    </div>
  );
};

export default Scan;
