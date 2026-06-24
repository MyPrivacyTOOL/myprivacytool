import { useState } from "react";
import { Button } from "@/components/ui/button";

const Report = () => {
  const [selected, setSelected] = useState<string | null>(null);

  const plans = [
    {
      id: "basic",
      name: "Basic Scan",
      price: "Free",
      period: "",
      features: [
        "See which brokers have your data",
        "Overview of data categories exposed",
        "Removal priority list",
      ],
      cta: "Start Free",
      highlight: false,
    },
    {
      id: "full",
      name: "Full Exposure Report",
      price: "$9",
      period: "/month",
      features: [
        "Everything in Basic",
        "Detailed data per broker — exactly what they hold",
        "One-click removal requests",
        "Monthly re-scan (brokers re-add you)",
        "Dark web monitoring",
        "Priority email support",
      ],
      cta: "Get Full Report",
      highlight: true,
      badge: "Most Popular",
    },
    {
      id: "annual",
      name: "Annual Protection",
      price: "$79",
      period: "/year",
      features: [
        "Everything in Full Report",
        "Save 30% vs monthly",
        "Quarterly privacy health score",
        "Family member add-on available",
      ],
      cta: "Get Annual",
      highlight: false,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Nav */}
      <nav className="px-6 py-4 flex items-center justify-between border-b border-white/10">
        <a href="/" className="text-white font-bold text-lg tracking-tight">
          MyPrivacyTOOL
        </a>
        <a href="/scan" className="text-white/50 text-sm hover:text-white transition-colors">
          ← Free Scan
        </a>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-block bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          Full Visibility · Active Removal · Continuous Protection
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6 tracking-tight">
          See Everything.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-400">
            Remove Everything.
          </span>
        </h1>

        <p className="text-white/60 text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
          A free scan shows you the problem. The Full Exposure Report gives you the
          complete picture — every broker, every data point, every removal path.
        </p>
        <p className="text-white/40 text-base mb-16 max-w-xl mx-auto">
          And because brokers re-add you within weeks, we scan continuously.
        </p>
      </section>

      {/* What's Different */}
      <section className="max-w-3xl mx-auto px-6 mb-16">
        <div className="grid md:grid-cols-3 gap-4 text-center">
          {[
            { icon: "🔬", title: "Deep Scan", desc: "Not just a surface check — we map every broker, every record, every data field they hold on you." },
            { icon: "✉️", title: "Automated Removal", desc: "We send removal requests on your behalf. One click, not 4,000 manual opt-outs." },
            { icon: "🔄", title: "Continuous Monitoring", desc: "Brokers re-add removed data within 30–90 days. We re-scan every month and remove again." },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="p-6 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="text-3xl mb-3">{icon}</div>
              <div className="font-bold text-white mb-2">{title}</div>
              <div className="text-white/40 text-sm leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
          Choose your level of protection
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              onClick={() => setSelected(plan.id)}
              className={`relative rounded-2xl border p-6 cursor-pointer transition-all duration-200 ${
                plan.highlight
                  ? "border-orange-400/60 bg-orange-500/5 shadow-lg shadow-orange-500/10"
                  : selected === plan.id
                  ? "border-white/40 bg-white/[0.05]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                  {plan.badge}
                </div>
              )}
              <div className="mb-4">
                <div className="text-white/60 text-sm font-semibold mb-1">{plan.name}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-white">{plan.price}</span>
                  {plan.period && <span className="text-white/40 text-sm">{plan.period}</span>}
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-white/60">
                    <span className="text-green-400 mt-0.5 flex-shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className={`w-full font-bold ${
                  plan.highlight
                    ? "bg-orange-500 hover:bg-orange-400 text-white"
                    : "bg-white/10 hover:bg-white/20 text-white"
                }`}
                onClick={() => setSelected(plan.id)}
              >
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison Table */}
      <section className="max-w-3xl mx-auto px-6 pb-16">
        <h2 className="text-xl font-bold text-center mb-8 text-white/80">Free scan vs Full Report</h2>
        <div className="rounded-xl overflow-hidden border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-4 py-3 text-white/40 font-semibold">Feature</th>
                <th className="px-4 py-3 text-white/40 font-semibold text-center">Free</th>
                <th className="px-4 py-3 text-orange-400 font-semibold text-center">Full Report</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Broker list (who has your data)", "✓", "✓"],
                ["Category overview (what type)", "✓", "✓"],
                ["Exact data fields per broker", "—", "✓"],
                ["Automated removal requests", "—", "✓"],
                ["Monthly re-scan", "—", "✓"],
                ["Dark web monitoring", "—", "✓"],
                ["Removal confirmation", "—", "✓"],
              ].map(([feature, free, paid]) => (
                <tr key={feature} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white/60">{feature}</td>
                  <td className="px-4 py-3 text-center text-white/30">{free}</td>
                  <td className="px-4 py-3 text-center text-green-400 font-semibold">{paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-white/20 text-xs px-6">
        <p>© 2026 MyPrivacyTOOL · <a href="/scan" className="hover:text-white/50 transition-colors">Free Scan</a> · <a href="/business" className="hover:text-white/50 transition-colors">For Business</a> · <a href="/the-encyclical" className="hover:text-white/50 transition-colors">Why This Matters</a></p>
      </footer>
    </div>
  );
};

export default Report;
