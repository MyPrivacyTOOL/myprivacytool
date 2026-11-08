import { Link } from "react-router-dom";
import FeatureStatus from "@/components/FeatureStatus";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";
import HkStopSpamCard from "@/components/HkStopSpamCard";
import pageMeta from "@/data/pageMeta.json";
import { PLAN_ROWS, formatMonthlyPrice } from "@/lib/plans";
import { FEATURE_STATUS, type FeatureId } from "@/config/featureStatus";

// MPC-9816 (F2, spec s5 "Option A", Chris 2026-11-07): the full exposure report is included from Basic. Every price is read from the plans data
// (src/data/plans.generated.json via src/lib/plans.ts); none is typed here. A claim for something not yet live keeps its wording and carries its badge
// (src/config/featureStatus.ts is the only place state is set; `pin` marks a part that is not live even when its feature is).
const price = (slug: string): string => {
  const p = PLAN_ROWS.find((r) => r.slug === slug);
  return p ? formatMonthlyPrice(p.monthly_price_cents) : "";
};

type Item = { text: string; feature?: FeatureId; pin?: "in_build" | "planned" };

const REPORT_CONTENTS: Item[] = [
  { text: "Your score and up to 54 browser hexagons, each with its real value, source and confidence." },
  { text: "Email checks." },
  { text: "Data brokers: nine sites shown as listed, not listed or not checked, with the page as proof for any you showed us and an opt-out guide for each. Licensed coverage that searches for you is added with Basic.", feature: "F1", pin: "planned" },
  { text: "Breaches: whether your email appears in known breaches.", feature: "F5", pin: "planned" },
  { text: "Every scan kept for 12 months, with a before and after.", feature: "F2", pin: "planned" },
  { text: "A PDF and JSON copy of your report.", feature: "F2", pin: "planned" },
];

const Report = () => {
  const ladder: { slug: string; label: string; items: Item[] }[] = [
    { slug: "basic", label: "Basic", items: [{ text: "the full report, 5 scans a month." }] },
    { slug: "pro", label: "Pro", items: [{ text: "adds a monthly re-scan, alerts and removal requests.", feature: "F4", pin: "planned" }] },
    { slug: "executive", label: "Executive", items: [{ text: "adds managed removal and unlimited scans.", feature: "F4", pin: "planned" }] },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/report"]} path="/report" />
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-10 text-center">
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6 tracking-tight">
          See what is exposed. <span className="text-brand">Then take it back.</span>
        </h1>
        <p className="text-muted-foreground text-lg md:text-xl mb-4 max-w-2xl mx-auto leading-relaxed" data-testid="report-lead">
          The free scan shows what your browser and email address give away. The full exposure report adds the rest. It is included from Basic, {price("basic")} a month.
        </p>
      </section>

      <HkStopSpamCard placement="report" />

      <section className="max-w-3xl mx-auto px-6 mb-12">
        <h2 className="text-2xl font-bold mb-4">What the full report contains</h2>
        <ul className="space-y-2" data-testid="report-contents">
          {REPORT_CONTENTS.map((f) => (
            <li key={f.text} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="text-brand mt-0.5 flex-shrink-0">✓</span>
              <span>{f.text}{f.feature && <FeatureStatus feature={f.feature} state={f.pin} />}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-6 mb-12">
        <h2 className="text-2xl font-bold mb-4">The ladder</h2>
        <ul className="space-y-2" data-testid="report-ladder">
          {ladder.map((l) => (
            <li key={l.slug} className="text-sm text-muted-foreground">
              <strong className="text-foreground">{l.label}, {price(l.slug)}:</strong> {l.items[0].text}
              {l.items[0].feature && <FeatureStatus feature={l.items[0].feature} state={l.items[0].pin} />}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground" data-testid="report-honest">
          The free scan is free and stays free. It does not search data brokers or check breaches for you; anything it could not check is marked "not checked", never "clear".
        </p>
        <div className="mt-6">
          <Button asChild className="font-bold"><Link to="/pricing">{FEATURE_STATUS.F3 === "live" ? "Get this plan" : "Join the list"}</Link></Button>
        </div>
      </section>
    </div>
  );
};

export default Report;
