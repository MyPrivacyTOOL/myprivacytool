import { useState } from "react";
import { Shield, Mail, ArrowRight, Check, Lock } from "lucide-react";

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
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-4 flex items-center gap-3">
        <Shield className="text-green-600" size={20} />
        <span className="text-green-600 text-sm font-bold tracking-widest uppercase">MyPrivacyTOOL</span>
        <span className="text-gray-400 text-xs ml-auto">Weekly Privacy Intelligence</span>
      </div>

      <div className="max-w-lg mx-auto px-6 py-16">

        {/* Icon */}
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
            <Mail className="text-green-600" size={28} />
          </div>
        </div>

        {/* Headline */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-gray-900 mb-3 leading-tight">
            Know exactly where<br />
            <span className="text-green-600">your data lives online.</span>
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Weekly privacy intelligence — what's changed in the data broker landscape, new removal tactics, and what you need to know to reclaim your digital footprint.
          </p>
        </div>

        {/* What you get */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-8">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-4">What you'll get</p>
          <div className="space-y-3">
            {[
              "Weekly data broker exposure updates",
              "Step-by-step removal guides",
              "New broker tactics & how to counter them",
              "Your exposure score updates",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <Check size={14} className="text-green-600 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-700">{item}</span>
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
                className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 disabled:opacity-50 transition-colors"
              />
            </div>

            {status === "error" && (
              <p className="text-red-500 text-xs">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-bold py-3.5 px-6 rounded-lg transition-colors"
            >
              {status === "loading" ? (
                <span className="animate-pulse">Subscribing...</span>
              ) : (
                <>
                  <ArrowRight size={16} />
                  Get Weekly Privacy Intelligence
                </>
              )}
            </button>

            {/* Trust signal */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <Lock size={11} className="text-gray-400" />
              <p className="text-gray-400 text-xs">No spam. Unsubscribe anytime. We never sell your data.</p>
            </div>
          </form>
        ) : (
          /* Success state */
          <div className="bg-gray-50 border border-green-200 rounded-xl p-6 text-center animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-green-50 border border-green-200 flex items-center justify-center mx-auto mb-4">
              <Check className="text-green-600" size={22} />
            </div>
            <p className="text-green-600 font-semibold mb-2">You're in.</p>
            <p className="text-gray-500 text-sm">
              Check your inbox — your first privacy briefing is on its way.
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 mt-6 text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              ← Run your free exposure scan
            </a>
          </div>
        )}

        {/* Footer */}
        <p className="text-gray-300 text-xs text-center mt-10">
          myprivacytool.io · Reclaim your digital footprint
        </p>
      </div>
    </div>
  );
}
