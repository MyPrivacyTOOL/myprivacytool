import { useState } from "react";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

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
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/report"]} path="/report" />
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-block bg-brand-soft border border-brand/30 text-brand text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
          Full Visibility · Active Removal · Continuous Protection
        </div>

        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6 tracking-tight">
          See Everything.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-brand">
            Remove Everything.
          </span>
        </h1>

        <p className="text-muted-foreground text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
          A free scan shows you the problem. The Full Exposure Report gives you the
          complete picture — every broker, every data point, every removal path.
        </p>
        <p className="text-muted-foreground text-base mb-16 max-w-xl mx-auto">
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
            <div key={title} className="p-6 rounded-xl bg-surface border border-surface-border">
              <div className="text-3xl mb-3">{icon}</div>
              <div className="font-bold text-foreground mb-2">{title}</div>
              <div className="text-muted-foreground text-sm leading-relaxed">{desc}</div>
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
                  ? "border-brand/60 bg-brand-soft shadow-lg"
                  : selected === plan.id
                  ? "border-brand/40 bg-muted"
                  : "border-surface-border bg-surface hover:border-brand/40"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand text-white text-xs font-bold px-3 py-1 rounded-full">
                  {plan.badge}
                </div>
              )}
              <div className="mb-4">
                <div className="text-muted-foreground text-sm font-semibold mb-1">{plan.name}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-foreground">{plan.price}</span>
                  {plan.period && <span className="text-muted-foreground text-sm">{plan.period}</span>}
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-brand mt-0.5 flex-shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className={`w-full font-bold ${
                  plan.highlight
                    ? "bg-brand hover:bg-brand/90 text-white"
                    : "bg-secondary hover:bg-muted text-foreground"
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
        <h2 className="text-xl font-bold text-center mb-8 text-foreground">Free scan vs Full Report</h2>
        <div className="rounded-xl overflow-hidden border border-surface-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Feature</th>
                <th className="px-4 py-3 text-muted-foreground font-semibold text-center">Free</th>
                <th className="px-4 py-3 text-brand font-semibold text-center">Full Report</th>
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
                <tr key={feature} className="border-b border-surface-border hover:bg-muted">
                  <td className="px-4 py-3 text-muted-foreground">{feature}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{free}</td>
                  <td className="px-4 py-3 text-center text-brand font-semibold">{paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
};

export default Report;
