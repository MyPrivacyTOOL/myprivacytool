import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Scan = () => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Nav */}
      <nav className="px-6 py-4 flex items-center justify-between border-b border-white/10">
        <a href="/" className="text-white font-bold text-lg tracking-tight">
          MyPrivacyTOOL
        </a>
        <a href="/the-encyclical" className="text-white/50 text-sm hover:text-white transition-colors">
          Why This Matters →
        </a>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          Free · Takes 60 Seconds · No Credit Card
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6 tracking-tight">
          Find Out What the<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400">
            Internet Knows About You
          </span>
        </h1>

        <p className="text-white/60 text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
          Over 4,000 data brokers are selling your personal information right now —
          your address, income, relationships, daily movements.
        </p>
        <p className="text-white/40 text-base mb-12 max-w-xl mx-auto">
          Run a free scan to see exactly who has your data and what they're selling.
        </p>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-red-400 focus:ring-red-400/20 h-12 text-base"
            />
            <Button
              type="submit"
              className="bg-red-500 hover:bg-red-400 text-white font-bold h-12 px-8 text-base whitespace-nowrap transition-all duration-200"
            >
              Start Free Scan →
            </Button>
          </form>
        ) : (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-8 py-6 max-w-md mx-auto">
            <div className="text-green-400 text-2xl mb-2">✓</div>
            <p className="text-white font-semibold mb-1">You're on the list.</p>
            <p className="text-white/50 text-sm">We'll send your privacy scan results to <span className="text-white/80">{email}</span></p>
          </div>
        )}

        <p className="text-white/25 text-xs mt-4">
          We never sell your data. Unsubscribe any time.
        </p>
      </section>

      {/* Stats Bar */}
      <section className="border-t border-b border-white/10 py-8">
        <div className="max-w-3xl mx-auto px-6 grid grid-cols-3 gap-6 text-center">
          {[
            { stat: "4,000+", label: "Data brokers tracked" },
            { stat: "700+", label: "Data points per person" },
            { stat: "$240B", label: "Industry selling your data" },
          ].map(({ stat, label }) => (
            <div key={stat}>
              <div className="text-2xl md:text-3xl font-black text-white mb-1">{stat}</div>
              <div className="text-white/40 text-xs md:text-sm">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* What You'll Discover */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
          Your scan will reveal
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { icon: "🏠", title: "Home address history", desc: "Every address you've lived at, still listed and for sale." },
            { icon: "💰", title: "Income estimates", desc: "Salary ranges inferred from public records and behaviour data." },
            { icon: "👥", title: "Family connections", desc: "Relatives, roommates, and associates tied to your profile." },
            { icon: "📍", title: "Location patterns", desc: "Where you work, shop, worship — mapped and sold." },
            { icon: "📞", title: "Phone numbers", desc: "Current and historical numbers linked to your identity." },
            { icon: "🔍", title: "Social profiles", desc: "Every public social account aggregated into one dossier." },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="flex gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors">
              <span className="text-2xl flex-shrink-0">{icon}</span>
              <div>
                <div className="font-semibold text-white text-sm mb-1">{title}</div>
                <div className="text-white/40 text-xs leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Social Proof */}
      <section className="max-w-2xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { quote: "I had no idea my home address, salary estimate, and my kids' names were all listed on one site. This is terrifying.", author: "Sarah M., Teacher" },
            { quote: "Found 47 brokers selling my data. The scan was fast and the removal guide was clear. Worth every minute.", author: "James T., Software Engineer" },
          ].map(({ quote, author }) => (
            <div key={author} className="bg-white/[0.03] border border-white/10 rounded-xl p-6">
              <p className="text-white/70 text-sm leading-relaxed mb-4">"{quote}"</p>
              <p className="text-white/30 text-xs font-semibold">{author}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-gradient-to-b from-transparent to-red-950/20 border-t border-white/10 py-16 text-center px-6">
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Your data is already out there.
        </h2>
        <p className="text-white/50 mb-8 max-w-md mx-auto">
          The only question is whether you know about it. Run your free scan now.
        </p>
        {!submitted && (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-red-400 h-12 text-base"
            />
            <Button
              type="submit"
              className="bg-red-500 hover:bg-red-400 text-white font-bold h-12 px-8 whitespace-nowrap"
            >
              Start Free Scan →
            </Button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-white/20 text-xs px-6">
        <p>© 2026 MyPrivacyTOOL · <a href="/the-encyclical" className="hover:text-white/50 transition-colors">Why This Matters</a> · <a href="/business" className="hover:text-white/50 transition-colors">For Business</a></p>
      </footer>
    </div>
  );
};

export default Scan;
