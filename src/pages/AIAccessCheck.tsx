import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Check, Eye, Lock, ScanLine, ShieldCheck } from "lucide-react";
import { submitHubSpotForm } from "@/lib/hubspot";
import {
  trackAIAccessCheckCta,
  trackAIAccessCheckSignup,
  trackAIAccessCheckView,
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
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

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
    document.title = "Free AI Access Check — MyPrivacyTOOL.IO";
    trackAIAccessCheckView(utm);
  }, [utm]);

  const scanHref = `/?${new URLSearchParams({
    utm_source: utm.utm_source || "ai-access-check",
    utm_medium: utm.utm_medium || "landing-page",
    utm_campaign: utm.utm_campaign || "mpc-6961",
  }).toString()}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      await submitHubSpotForm({
        formId: FORM_ID,
        fields: { email, source_tag: SOURCE_TAG },
        pageName: "AI Access Check waitlist",
      });
      trackAIAccessCheckSignup(utm);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 border border-[#00A03C]/40 text-[#00A03C] text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          <ScanLine size={14} /> Free · No sign-up to scan
        </div>
        <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-5">
          Are your AI tools<br />
          <span className="text-[#00A03C]">reading your email?</span>
        </h1>
        <p className="text-gray-400 text-base md:text-lg max-w-2xl mx-auto leading-relaxed mb-8">
          Run the free AI Access Check: in about three minutes, see what AI systems and data brokers
          can learn about you from your browser alone — no account, no personal details.
        </p>
        <Link
          to={scanHref}
          onClick={() => trackAIAccessCheckCta("hero")}
          className="inline-flex items-center justify-center gap-2 bg-[#00A03C] hover:bg-[#007A2E] text-white text-sm font-bold py-3.5 px-8 rounded-lg transition-colors"
        >
          <ArrowRight size={16} /> Run the free scan
        </Link>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-14 grid gap-4 md:grid-cols-3" aria-label="What the check covers">
        {CHECKS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-[#1A1A1A] border border-[#2A2A2A] border-t-2 border-t-[#0056B3] rounded-xl p-5">
            <Icon className="text-[#00A03C] mb-3" size={22} />
            <h2 className="text-sm font-bold mb-2">{title}</h2>
            <p className="text-xs text-gray-400 leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      <section id="waitlist" className="max-w-lg mx-auto px-6 pb-20" aria-label="Join the waitlist">
        <div className="bg-[#1A1A1A] border border-[#00A03C]/30 rounded-xl p-6">
          <h2 className="text-xl font-bold mb-2">Get the full AI Access report first</h2>
          <p className="text-sm text-gray-400 mb-5 leading-relaxed">
            We're building a deeper report on top of the free scan. Join the waitlist for early access.
          </p>

          {status !== "success" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label htmlFor="ai-check-email" className="sr-only">Email address</label>
              <input
                id="ai-check-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={status === "loading"}
                className="w-full bg-black border border-[#2A2A2A] rounded-lg px-4 py-3.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#00A03C] disabled:opacity-50 transition-colors"
              />
              {status === "error" && <p role="alert" className="text-red-400 text-xs">{errorMsg}</p>}
              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full flex items-center justify-center gap-2 bg-[#00A03C] hover:bg-[#007A2E] disabled:opacity-60 text-white text-sm font-bold py-3.5 px-6 rounded-lg transition-colors"
              >
                {status === "loading" ? <span className="animate-pulse">Joining...</span> : <><ArrowRight size={16} /> Join the waitlist</>}
              </button>
              <div className="flex items-start justify-center gap-2">
                <Lock size={11} className="text-gray-600 mt-0.5 shrink-0" />
                <p className="text-gray-600 text-xs">
                  We'll email you about the AI Access report only. Unsubscribe anytime. See our{" "}
                  <Link to="/privacy" className="underline hover:text-gray-400">privacy policy</Link>.
                </p>
              </div>
            </form>
          ) : (
            <div className="text-center animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-black border border-[#00A03C] flex items-center justify-center mx-auto mb-4">
                <Check className="text-[#00A03C]" size={22} />
              </div>
              <p className="text-[#00A03C] font-semibold mb-2">You're on the list.</p>
              <p className="text-gray-400 text-sm mb-5">While you wait, run the free scan now.</p>
              <Link
                to={scanHref}
                onClick={() => trackAIAccessCheckCta("post_signup")}
                className="inline-flex items-center gap-2 text-sm text-[#00A03C] hover:text-white transition-colors"
              >
                Run the free scan <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
        <p className="text-gray-700 text-xs text-center mt-8">myprivacytool.io · Protecting your digital footprint</p>
      </section>
    </div>
  );
}
