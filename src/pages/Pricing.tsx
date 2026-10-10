import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

// MPC-6545 pricing page. Prices are the launch list prices from the Notion "Pricing Architecture"
// (3-tier, Jun 2026), the highest consumer pricing considered; Chris's call is to start there and
// only go down. There is no checkout yet, so the paid tiers send people to launch updates, not a purchase.
interface Plan {
  name: string;
  tagline: string;
  monthly: string | null;
  annual: string | null;
  features: string[];
  cta: { label: string; to: string };
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Scout",
    tagline: "See where your data is listed.",
    monthly: null,
    annual: null,
    features: [
      "1 exposure scan per month",
      "Exposure summary dashboard",
      "Data broker detection (read-only)",
      "Privacy education resources",
    ],
    cta: { label: "Check my exposure", to: "/scan" },
  },
  {
    name: "Guardian",
    tagline: "Get your data removed and keep it off.",
    monthly: "$9.99",
    annual: "$99.99",
    features: [
      "Unlimited exposure scans",
      "Automated removal requests to the top 100 data brokers",
      "Quarterly re-scans and removal re-checks",
      "Broker-by-broker removal status",
      "Email alerts on new exposures",
    ],
    cta: { label: "Get launch updates", to: "/newsletter" },
    highlight: true,
  },
  {
    name: "Sentinel",
    tagline: "Maximum coverage for high-exposure people.",
    monthly: "$19.99",
    annual: "$199.99",
    features: [
      "Everything in Guardian",
      "Removal requests to 400+ data brokers",
      "Monthly re-scans and removal re-checks",
      "Dark web breach monitoring",
      "Priority support, 24-hour response",
    ],
    cta: { label: "Get launch updates", to: "/newsletter" },
  },
];

const Pricing = () => (
  <>
    <Seo {...pageMeta["/pricing"]} path="/pricing" />
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-foreground">Pricing</h1>
        <p className="mb-4 text-lg text-muted-foreground">
          The scan is free. Paid plans remove your data from brokers and keep it off.
        </p>
        <p className="mb-10 text-sm text-muted-foreground">
          Paid plans are not open yet. Prices below are the launch prices; join the list
          and we will tell you when they open.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <section
              key={plan.name}
              aria-labelledby={`plan-${plan.name}`}
              className={`flex flex-col rounded-lg border p-6 ${
                plan.highlight ? "border-primary" : "border-border"
              }`}
            >
              <h2 id={`plan-${plan.name}`} className="text-xl font-semibold text-foreground">
                {plan.name}
              </h2>
              <p className="mb-4 text-sm text-muted-foreground">{plan.tagline}</p>
              <p className="text-3xl font-bold text-foreground">
                {plan.monthly ? (
                  <>
                    {plan.monthly}
                    <span className="text-base font-normal text-muted-foreground"> /month</span>
                  </>
                ) : (
                  "Free"
                )}
              </p>
              <p className="mb-6 min-h-[1.25rem] text-sm text-muted-foreground">
                {plan.annual ? `or ${plan.annual} billed yearly` : "No credit card needed"}
              </p>
              <ul className="mb-6 flex-1 space-y-2 text-sm text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild variant={plan.highlight ? "default" : "outline"}>
                <Link to={plan.cta.to}>{plan.cta.label}</Link>
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

export default Pricing;
