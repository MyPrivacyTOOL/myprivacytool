import { useState } from "react";
import { Shield, Eye, MapPin, Phone, Mail, Globe, Database, ArrowRight, Check, X } from "lucide-react";
import Seo from "@/components/Seo";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import { trackStartSignup } from "@/lib/analytics";

// HubSpot form "Start Scan" (portal 246502821). Form GUIDs are public (they ship in every
// embed). Override per environment with VITE_HUBSPOT_START_FORM_ID. The form defines a hidden
// "source_tag" field, which we also send explicitly below.
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_START_FORM_ID || "22ee30ae-6cf9-419b-aa46-b656b0e7b1bf";
const SOURCE_TAG = "start-scan";

const hexagonData = [
  { icon: Eye, label: "Name", value: "Detected from your profile", color: "#ff4444" },
  { icon: MapPin, label: "Location", value: "City & country visible", color: "#ff6b35" },
  { icon: Phone, label: "Phone", value: "Checking public records...", color: "#ff4444" },
  { icon: Mail, label: "Email", value: "Associated addresses found", color: "#ff6b35" },
  { icon: Globe, label: "Social Profiles", value: "Multiple platforms linked", color: "#ff4444" },
  { icon: Database, label: "Data Broker Exposure", value: "Estimated 40+ sites", color: "#ff6b35" },
];

const channels = [
  { name: "WhatsApp", emoji: "💬", url: "https://wa.me/YOUR_WHATSAPP_NUMBER?text=scan+me", color: "#25D366" },
  { name: "Telegram", emoji: "✈️", url: "https://t.me/MyPrivacyToolBot?start=scan", color: "#2CA5E0" },
  { name: "Messenger", emoji: "💙", url: "https://m.me/myprivacytool", color: "#006AFF" },
  { name: "Instagram", emoji: "📸", url: "https://ig.me/m/myprivacytool", color: "#E1306C" },
  { name: "Email", emoji: "📧", url: "mailto:scan@myprivacytool.io?subject=Scan%20Me", color: "#888" },
];

export default function Start() {
  const [confirmed, setConfirmed] = useState<null | boolean>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleConfirm = (yes: boolean) => {
    setConfirmed(yes);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !consent) return;
    setSending(true);
    setErrorMsg("");
    try {
      await submitHubSpotForm({
        formId: FORM_ID,
        fields: { email: email.trim(), source_tag: SOURCE_TAG, ...consentFields("start_page") },
        pageName: "Start scan",
      });
      trackStartSignup({ source: "start_page" });
      setSubmitted(true);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <Seo title="Start Your Free Privacy Scan | MyPrivacyTOOL" description="Start a free privacy scan from WhatsApp, Telegram, Messenger, Instagram or email and see what is exposed about you." path="/start" />
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <Shield className="text-primary" size={20} />
        <span className="text-primary text-sm font-bold tracking-widest uppercase">MyPrivacyTOOL</span>
        <span className="text-muted-foreground text-xs ml-auto">First Hexagon — Privacy Exposure Report</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Intro */}
        <div className="mb-10">
          <p className="text-muted-foreground text-xs tracking-widest uppercase mb-3">What we know about you right now</p>
          <h1 className="text-3xl font-bold text-foreground mb-4 leading-tight">
            Your privacy is already<br />
            <span className="text-destructive">being exposed.</span>
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Based on publicly available data and data broker records, here is what anyone can find about you today — before you've done anything to protect yourself.
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
                <p className="text-sm text-foreground">{item.value}</p>
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
              Confirm and we'll show you your full privacy report — and how to remove yourself from 40+ data broker sites.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleConfirm(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold py-3 px-6 rounded-lg transition-colors"
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

        {/* Y — confirmed */}
        {confirmed === true && !submitted && (
          <div className="bg-primary/5 border border-primary/30 rounded-xl p-6 mb-8 animate-fade-in">
            <p className="text-primary text-sm font-semibold mb-1">✅ Confirmed.</p>
            <p className="text-muted-foreground text-xs mb-5">
              Enter your email and we'll send your full privacy report — and start removing you from data broker sites.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 bg-background border border-input rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={sending}
                className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-bold py-3 px-5 rounded-lg transition-colors flex items-center gap-2"
              >
                <ArrowRight size={16} />
                {sending ? "Sending..." : "Start"}
              </button>
              <ConsentCheckbox id="start-consent" checked={consent} onChange={setConsent} disabled={sending} labelClassName="text-muted-foreground" />
            </form>
            {errorMsg && <p role="alert" className="text-destructive text-xs mt-3">{errorMsg}</p>}
          </div>
        )}

        {/* Submitted */}
        {submitted && (
          <div className="bg-primary/5 border border-primary/30 rounded-xl p-6 mb-8 animate-fade-in">
            <p className="text-primary font-semibold mb-1">✅ You're in the queue.</p>
            <p className="text-muted-foreground text-xs">
              Check your inbox — your full privacy report is on its way. We'll also start the data broker removal process automatically.
            </p>
          </div>
        )}

        {/* N — not me */}
        {confirmed === false && (
          <div className="bg-card border border-border rounded-xl p-6 mb-8 animate-fade-in">
            <p className="text-foreground font-semibold mb-1">🔍 Let's find the right profile.</p>
            <p className="text-muted-foreground text-xs mb-4">
              No problem — enter your name and we'll run a fresh scan specifically for you.
            </p>
            <a
              href="/scan"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold py-3 px-6 rounded-lg transition-colors"
            >
              <ArrowRight size={16} />
              Run my scan
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
                <span className="text-lg">{ch.emoji}</span>
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
