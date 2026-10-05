import { useState } from "react";
import { trackNewsletterSignup } from "@/lib/analytics";
import { Shield, Mail, ArrowRight, Check, Lock } from "lucide-react";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

const SUPABASE_URL = "https://xmdmkumwxpgahmlweuug.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4Nn6HUiPhuUqCgS04tvU0Q_3Ua6R2tV";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/subscribers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          email,
          consent_given_at: new Date().toISOString(),
          consent_source: "newsletter_page",
        }),
      });

      if (res.ok || res.status === 201) {
        trackNewsletterSignup({ source: "newsletter_page" });
        setStatus("success");
      } else {
        const data = await res.json().catch(() => ({}));
        // Handle duplicate email gracefully
        if (data?.code === "23505" || res.status === 409) {
          setStatus("success"); // Already subscribed — treat as success
        } else {
          throw new Error(data?.message || `Error ${res.status}`);
        }
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo {...pageMeta["/newsletter"]} path="/newsletter" />
      {/* Header */}
      <div className="border-b border-brand/30 px-6 py-4 flex items-center gap-3">
        <Shield className="text-brand" size={20} />
        <span className="text-brand text-sm font-bold tracking-widest uppercase">MyPrivacyTOOL</span>
        <span className="text-muted-foreground text-xs ml-auto">Privacy Check</span>
      </div>

      <div className="max-w-lg mx-auto px-6 py-16">

        {/* Icon */}
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-full bg-surface border border-brand/40 flex items-center justify-center">
            <Mail className="text-brand" size={28} />
          </div>
        </div>

        {/* Headline */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-foreground mb-3 leading-tight">
            Privacy Check<br />
            <span className="text-brand">Stay on top of your data.</span>
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            A weekly note on what has changed with data brokers, new removal steps, and what you need to know to protect your digital footprint.
          </p>
        </div>

        {/* What you get */}
        <div className="bg-surface border border-surface-border rounded-xl p-5 mb-8">
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">What you'll get</p>
          <div className="space-y-3">
            {[
              "Weekly data exposure updates",
              "Step-by-step removal guides",
              "New privacy risks and how to reduce them",
              "Your personal exposure score updates",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <Check size={14} className="text-brand mt-0.5 shrink-0" />
                <span className="text-sm text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Form */}
        {status !== "success" ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={status === "loading"}
                className="w-full bg-background border border-surface-border rounded-lg px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand disabled:opacity-50 transition-colors"
              />
            </div>

            {status === "error" && (
              <p role="alert" className="text-foreground text-xs border-l-4 border-destructive pl-3">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover hover:text-brand-white disabled:opacity-60 text-primary-foreground text-sm font-bold py-3.5 px-6 rounded-lg transition-colors"
            >
              {status === "loading" ? (
                <span className="animate-pulse">Subscribing...</span>
              ) : (
                <>
                  <ArrowRight size={16} />
                  Subscribe to Privacy Check
                </>
              )}
            </button>

            {/* Trust signal */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <Lock size={11} className="text-muted-foreground" />
              <p className="text-muted-foreground text-xs">No spam. Unsubscribe anytime. We never sell your data.</p>
            </div>
          </form>
        ) : (
          /* Success state */
          <div className="bg-surface border border-brand/40 rounded-xl p-6 text-center animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-background border border-brand flex items-center justify-center mx-auto mb-4">
              <Check className="text-brand" size={22} />
            </div>
            <p className="text-brand font-semibold mb-2">You're in.</p>
            <p className="text-muted-foreground text-sm">
              Check your inbox — your first Privacy Check is on its way.
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 mt-6 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Check My Exposure
            </a>
          </div>
        )}

        {/* Footer */}
        <p className="text-muted-foreground text-xs text-center mt-10">
          MyPrivacyTOOL · See it. Control it. Protect it.
        </p>
      </div>
    </div>
  );
}
