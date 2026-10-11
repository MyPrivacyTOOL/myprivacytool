import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { trackPricingPlanClick, trackPricingView } from "@/lib/analytics";

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

const Pricing = () => {
  useEffect(() => {
    trackPricingView();
  }, []);

  return (
  <>
    <Seo {...pageMeta["/pricing"]} path="/pricing" />
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-foreground">Pricing</h1>
        <p className="mb-4 text-lg text-muted-foreground">
          The scan is free. Paid plans remove your data from brokers and keep it off.
        </p>
        <p className="mb-10 text-sm text-muted-foreground">
          Paid plans are not open yet. Prices below are the planned prices; join the list
          and we will tell you when they open.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <section
              key={plan.name}
              aria-labelledby={`plan-${plan.name}`}
              className="flex flex-col rounded-lg border border-border p-6"
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
              <Button asChild variant="outline">
                <Link to={plan.cta.to} onClick={() => trackPricingPlanClick(plan.name.toLowerCase(), plan.cta.to)}>
                  {plan.cta.label}
                </Link>
              </Button>
            </section>
          ))}
        </div>

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
