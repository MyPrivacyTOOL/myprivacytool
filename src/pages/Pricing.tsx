import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { useExperiment } from "@/hooks/useExperiment";
import {
  trackExperimentCta,
  trackExperimentExposure,
  trackPricingPlanClick,
  trackPricingView,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

// MPC-7460: locked pricing approved Sep 23 2026 (Free / Basic / Pro / Executive). Scan allowances are
// placeholder defaults pending review.
// There is no checkout yet, so the paid tiers send people to launch updates, not a purchase.
interface Plan {
  name: string;
  monthly: string;
  scans: string;
  note?: string;
  cta: { label: string; to: string };
}

const PLANS: Plan[] = [
  { name: "Free", scans: "1 scan per month", note: "No credit card required", monthly: "$0", cta: { label: "Check my exposure", to: "/scan" } },
  { name: "Basic", scans: "5 scans per month", monthly: "$7.99", cta: { label: "Get launch updates", to: "/newsletter" } },
  { name: "Pro", scans: "25 scans per month", monthly: "$14.99", cta: { label: "Get launch updates", to: "/newsletter" } },
  { name: "Executive", scans: "Unlimited scans", monthly: "$49.99", cta: { label: "Get launch updates", to: "/newsletter" } },
];

// MPC-7638: A/B tests (docs/ab-testing.md). Every variant string below is truthful for a page with no
// checkout yet; the trust line makes no claim beyond what the Free plan already states.
const HEADLINE = {
  control: { h1: "Pricing", sub: "The scan is free. Paid plans remove your data from brokers and keep it off." },
  free_first: { h1: "Know your exposure for free. Pay to remove it.", sub: "Paid plans remove your data from brokers and keep it off." },
} as const;
const PAID_CTA_LABEL = { control: "Get launch updates", solid: "Get launch updates", notify_text: "Notify me when plans open" } as const;
const TRUST_LINE = "The scan is free and needs no credit card.";
const PRICING_TESTS = ["pricing_headline", "pricing_cta", "pricing_tiers", "pricing_social_proof"] as const;

const TrustLine = () => <p className="mb-6 text-sm font-medium text-foreground">{TRUST_LINE}</p>;

const Pricing = () => {
  const headline = useExperiment("pricing_headline");
  const cta = useExperiment("pricing_cta");
  const tiers = useExperiment("pricing_tiers");
  const proof = useExperiment("pricing_social_proof");
  const assignments = { pricing_headline: headline, pricing_cta: cta, pricing_tiers: tiers, pricing_social_proof: proof };
  // Only live, non-forced assignments are reported (QA ?ab_ overrides never count).
  const live = PRICING_TESTS.filter((id) => assignments[id].active);

  useEffect(() => {
    trackPricingView();
    live.forEach((id) => trackExperimentExposure(id, assignments[id].variantId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = HEADLINE[headline.variantId as keyof typeof HEADLINE] ?? HEADLINE.control;
  const paidLabel = PAID_CTA_LABEL[cta.variantId as keyof typeof PAID_CTA_LABEL] ?? PAID_CTA_LABEL.control;
  const onPlanClick = (plan: Plan) => {
    const variants = Object.fromEntries(live.map((id) => [id, assignments[id].variantId]));
    trackPricingPlanClick(plan.name.toLowerCase(), plan.cta.to, variants);
    live.forEach((id) => trackExperimentCta(id, assignments[id].variantId));
  };

  return (
  <>
    <Seo {...pageMeta["/pricing"]} path="/pricing" />
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-foreground">{copy.h1}</h1>
        <p className="mb-4 text-lg text-muted-foreground">{copy.sub}</p>
        <p className="mb-10 text-sm text-muted-foreground">
          Paid plans are not open yet. Prices below are the planned prices; join the list
          and we will tell you when they open.
        </p>

        {proof.variantId === "above_plans" && <TrustLine />}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <section
              key={plan.name}
              aria-labelledby={`plan-${plan.name}`}
              className={cn(
                "flex flex-col rounded-lg border border-border p-6",
                tiers.variantId === "highlight_pro" && plan.name === "Pro" && "border-2 border-primary shadow-lg",
              )}
            >
              <h2 id={`plan-${plan.name}`} className="mb-4 text-xl font-semibold text-foreground">
                {plan.name}
              </h2>
              <p className="mb-4 text-3xl font-bold text-foreground">
                {plan.monthly}
                <span className="text-base font-normal text-muted-foreground"> /month</span>
              </p>
              <ul className="mb-6 flex-1 space-y-1 text-sm text-muted-foreground">
                <li>{plan.scans}</li>
                {plan.note && <li>{plan.note}</li>}
              </ul>
              <Button asChild variant={plan.name !== "Free" && cta.variantId === "solid" ? "default" : "outline"}>
                <Link to={plan.cta.to} onClick={() => onPlanClick(plan)}>
                  {plan.name === "Free" ? plan.cta.label : paidLabel}
                </Link>
              </Button>
            </section>
          ))}
        </div>
        {proof.variantId === "below_plans" && <div className="mt-6"><TrustLine /></div>}

        <section className="mt-12 rounded-lg bg-muted p-6">
          <h2 className="mb-2 text-xl font-semibold text-foreground">For teams and businesses</h2>
          <p className="mb-4 text-muted-foreground">
            Protecting staff or executives? Tell us about your team and we will put a quote together.
          </p>
          <Button asChild variant="outline">
            <Link to="/business">Talk to us about business plans</Link>
          </Button>
        </section>

        <p className="mt-8 text-xs text-muted-foreground">
          Prices are in US dollars. See our <Link to="/terms" className="underline">Terms</Link> and{" "}
          <Link to="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  </>
  );
};

export default Pricing;
