import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Business = () => {
  const [form, setForm] = useState({ name: "", email: "", company: "", size: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.email && form.company) setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#06060a] text-white font-sans">
      {/* Nav */}
      <nav className="px-6 py-4 flex items-center justify-between border-b border-white/10">
        <a href="/" className="text-white font-bold text-lg tracking-tight">
          MyPrivacyTOOL
        </a>
        <div className="flex items-center gap-6 text-sm">
          <a href="/scan" className="text-white/50 hover:text-white transition-colors">Individual →</a>
          <a href="/report" className="text-white/50 hover:text-white transition-colors">Pricing</a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-block bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
              For Teams & Organisations
            </div>

            <h1 className="text-4xl md:text-5xl font-black leading-tight mb-6 tracking-tight">
              Your Employees Are{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                Your Attack Surface
              </span>
            </h1>

            <p className="text-white/60 text-lg mb-4 leading-relaxed">
              When data brokers sell your team's home addresses, personal emails,
              and family connections — social engineering and targeted attacks
              become trivially easy.
            </p>
            <p className="text-white/40 text-base mb-8">
              We run company-wide privacy audits and remove your team from
              the public data broker ecosystem — before attackers exploit it.
            </p>

            <div className="flex flex-wrap gap-4 text-sm text-white/50">
              {["SOC 2 Compliant", "GDPR Ready", "Bulk Pricing", "Dedicated Support"].map((tag) => (
                <span key={tag} className="flex items-center gap-1.5">
                  <span className="text-blue-400">✓</span> {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Contact Form */}
          <div>
            {!submitted ? (
              <form
                onSubmit={handleSubmit}
                className="bg-white/[0.04] border border-white/10 rounded-2xl p-8 space-y-4"
              >
                <h2 className="text-xl font-bold mb-2">Get a Free Company Audit</h2>
                <p className="text-white/40 text-sm mb-6">
                  We'll scan your team and send a full exposure report within 48 hours.
                </p>
                <Input
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 h-11"
                />
                <Input
                  type="email"
                  placeholder="Work email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 h-11"
                />
                <Input
                  placeholder="Company name"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  required
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 h-11"
                />
                <select
                  value={form.size}
                  onChange={(e) => setForm({ ...form, size: e.target.value })}
                  className="w-full bg-white/5 border border-white/20 text-white/70 rounded-md px-3 h-11 text-sm focus:outline-none focus:border-blue-400"
                >
                  <option value="">Team size</option>
                  <option value="1-10">1–10 employees</option>
                  <option value="11-50">11–50 employees</option>
                  <option value="51-200">51–200 employees</option>
                  <option value="200+">200+ employees</option>
                </select>
                <Button
                  type="submit"
                  className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold h-11 text-base transition-all duration-200"
                >
                  Request Free Company Audit →
                </Button>
                <p className="text-white/20 text-xs text-center">
                  No payment required. Results in 48 hours.
                </p>
              </form>
            ) : (
              <div className="bg-white/[0.04] border border-blue-500/30 rounded-2xl p-8 text-center">
                <div className="text-blue-400 text-4xl mb-4">✓</div>
                <h3 className="text-xl font-bold mb-2">Request received</h3>
                <p className="text-white/50 text-sm">
                  We'll run your company audit and send results to{" "}
                  <span className="text-white/80">{form.email}</span> within 48 hours.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Risk Cards */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-center mb-10 text-white/80">
          What exposed employee data enables
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: "🎣",
              threat: "Spear Phishing",
              desc: "Attackers use personal data (family names, home town, interests) to craft convincing messages that bypass spam filters and staff awareness.",
              severity: "High",
              color: "red",
            },
            {
              icon: "📞",
              threat: "Vishing & Impersonation",
              desc: "With a home address and personal number, attackers impersonate IT support or leadership by phone — then extract credentials.",
              severity: "High",
              color: "red",
            },
            {
              icon: "🔑",
              threat: "Account Takeover",
              desc: "Security questions answered from public data. Reset flows bypassed. Email, banking, and corporate accounts accessed without a single password.",
              severity: "Critical",
              color: "orange",
            },
          ].map(({ icon, threat, desc, severity, color }) => (
            <div key={threat} className="p-6 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl">{icon}</span>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded-full ${
                    color === "red"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-orange-500/10 text-orange-400"
                  }`}
                >
                  {severity}
                </span>
              </div>
              <div className="font-bold text-white mb-2">{threat}</div>
              <div className="text-white/40 text-sm leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-white/10 py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">How the company audit works</h2>
          <div className="space-y-6">
            {[
              { step: "01", title: "Submit your team list", desc: "Provide a list of employee names and work emails (or let us start with your leadership team)." },
              { step: "02", title: "We run the full scan", desc: "Our system checks 4,000+ data brokers for each team member — addresses, phone numbers, family, social profiles, income estimates." },
              { step: "03", title: "You get the exposure report", desc: "We send you a full company privacy report within 48 hours — who's exposed, what data is visible, and your risk level." },
              { step: "04", title: "We remove your team", desc: "On your approval, we send removal requests across all brokers. Most removals complete within 7–14 days." },
              { step: "05", title: "Monthly monitoring", desc: "Brokers re-add data constantly. We scan monthly and remove continuously — keeping your team off the map." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex gap-6 items-start">
                <div className="text-blue-400/40 font-black text-2xl w-10 flex-shrink-0">{step}</div>
                <div>
                  <div className="font-semibold text-white mb-1">{title}</div>
                  <div className="text-white/40 text-sm leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Tiers */}
      <section className="border-t border-white/10 py-16 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Business pricing</h2>
          <p className="text-white/40 text-sm mb-12">Per-employee per month, billed annually. Volume discounts for 50+ seats.</p>
          <div className="grid md:grid-cols-3 gap-6 text-left">
            {[
              { tier: "Starter", price: "$5", per: "/employee/mo", seats: "Up to 10 employees", features: ["Monthly scan", "Automated removals", "Company report", "Email support"] },
              { tier: "Team", price: "$4", per: "/employee/mo", seats: "11–100 employees", features: ["Everything in Starter", "Slack/Teams alerts", "Executive priority scan", "Quarterly review call"], highlight: true },
              { tier: "Enterprise", price: "Custom", per: "", seats: "100+ employees", features: ["Everything in Team", "API access", "Dedicated account manager", "SLA guarantee", "SSO / SCIM"] },
            ].map(({ tier, price, per, seats, features, highlight }) => (
              <div
                key={tier}
                className={`rounded-2xl border p-6 ${
                  highlight ? "border-blue-400/50 bg-blue-500/5" : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="text-white/50 text-sm font-semibold mb-1">{tier}</div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-3xl font-black text-white">{price}</span>
                  <span className="text-white/30 text-xs">{per}</span>
                </div>
                <div className="text-white/30 text-xs mb-5">{seats}</div>
                <ul className="space-y-2 mb-6">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-white/60">
                      <span className="text-blue-400 flex-shrink-0 mt-0.5">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className={`w-full font-bold ${
                    highlight ? "bg-blue-500 hover:bg-blue-400 text-white" : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                  onClick={() => document.querySelector("form")?.scrollIntoView({ behavior: "smooth" })}
                >
                  {tier === "Enterprise" ? "Contact Us" : "Get Started"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-white/20 text-xs px-6">
        <p>© 2026 MyPrivacyTOOL · <a href="/scan" className="hover:text-white/50 transition-colors">Individual Scan</a> · <a href="/report" className="hover:text-white/50 transition-colors">Pricing</a> · <a href="/the-encyclical" className="hover:text-white/50 transition-colors">Why This Matters</a></p>
      </footer>
    </div>
  );
};

export default Business;
