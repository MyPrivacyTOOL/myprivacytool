import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo from "@/components/Seo";

const Scan = () => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo title="Free Data Exposure Scan | MyPrivacyTOOL" description="Run a free 60-second scan to see what data brokers and the open internet know about you, then get step-by-step guides to remove it." path="/scan" />
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block bg-primary/10 border border-primary/30 text-primary text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          Free · Takes 60 Seconds · No Credit Card
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6 tracking-tight">
          Find Out What the<br />
          <span className="text-primary">
            Internet Knows About You
          </span>
        </h1>

        <p className="text-muted-foreground text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
          Over 4,000 data brokers are selling your personal information right now —
          your address, income, relationships, daily movements.
        </p>
        <p className="text-muted-foreground text-base mb-12 max-w-xl mx-auto">
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
              className="h-12 text-base"
            />
            <Button
              type="submit"
              className="font-bold h-12 px-8 text-base whitespace-nowrap"
            >
              Start Free Scan →
            </Button>
          </form>
        ) : (
          <div className="bg-primary/10 border border-primary/30 rounded-xl px-8 py-6 max-w-md mx-auto">
            <div className="text-primary text-2xl mb-2">✓</div>
            <p className="text-foreground font-semibold mb-1">You're on the list.</p>
            <p className="text-muted-foreground text-sm">We'll send your privacy scan results to <span className="text-foreground">{email}</span></p>
          </div>
        )}

        <p className="text-muted-foreground text-xs mt-4">
          We never sell your data. Unsubscribe any time.
        </p>
      </section>

      {/* Stats Bar */}
      <section className="border-t border-b border-border py-8">
        <div className="max-w-3xl mx-auto px-6 grid grid-cols-3 gap-6 text-center">
          {[
            { stat: "4,000+", label: "Data brokers tracked" },
            { stat: "700+", label: "Data points per person" },
            { stat: "$240B", label: "Industry selling your data" },
          ].map(({ stat, label }) => (
            <div key={stat}>
              <div className="text-2xl md:text-3xl font-black text-foreground mb-1">{stat}</div>
              <div className="text-muted-foreground text-xs md:text-sm">{label}</div>
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

      {/* Social Proof */}
      <section className="max-w-2xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { quote: "I had no idea my home address, salary estimate, and my kids' names were all listed on one site. This is terrifying.", author: "Sarah M., Teacher" },
            { quote: "Found 47 brokers selling my data. The scan was fast and the removal guide was clear. Worth every minute.", author: "James T., Software Engineer" },
          ].map(({ quote, author }) => (
            <div key={author} className="bg-card border border-border rounded-xl p-6">
              <p className="text-foreground/80 text-sm leading-relaxed mb-4">"{quote}"</p>
              <p className="text-muted-foreground text-xs font-semibold">{author}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-muted/40 border-t border-border py-16 text-center px-6">
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Your data is already out there.
        </h2>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
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
              className="h-12 text-base"
            />
            <Button
              type="submit"
              className="font-bold h-12 px-8 whitespace-nowrap"
            >
              Start Free Scan →
            </Button>
          </form>
        )}
      </section>

    </div>
  );
};

export default Scan;
