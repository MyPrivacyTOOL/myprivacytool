import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo from "@/components/Seo";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import SubmitButton from "@/components/SubmitButton";
import pageMeta from "@/data/pageMeta.json";
import { useExperiment } from "@/hooks/useExperiment";
import { useLeadSubmit } from "@/hooks/useLeadSubmit";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import { suggestEmail, validateEmail } from "@/lib/formFeedback";
import { cn } from "@/lib/utils";
import { PLAN_ROWS, formatMonthlyPrice } from "@/lib/plans";
import {
  trackExperimentCta,
  trackExperimentExposure,
  trackFormSubmitError,
  trackFormValidationError,
  trackPricingPlanClick,
  trackPricingView,
  trackPricingWaitlistSignup,
} from "@/lib/analytics";

// MPC-7460: locked pricing approved Sep 23 2026 (Free / Basic / Pro / Executive). Scan allowances are
// placeholder defaults pending review.
// MPC-7626: there is no checkout yet, so the paid tiers join a waitlist (HubSpot, source_tag
// "pricing-waitlist") instead of a purchase. Set VITE_HUBSPOT_PRICING_WAITLIST_FORM_ID to a dedicated
// form GUID; it needs email, plan_interest, source_tag, consent_given_at and consent_source fields.
// Until it is set we reuse the "AI Access Check waitlist" form (same portal, has email, source_tag and
// the consent fields) and rely on source_tag to tell the leads apart.
const FORM_ID =
  (import.meta.env.VITE_HUBSPOT_PRICING_WAITLIST_FORM_ID as string | undefined) ||
  "61deaf96-7b03-474d-8285-5d0bf2da13e8";
const SOURCE_TAG = "pricing-waitlist";
const WAITLIST_ID = "waitlist";

interface Plan {
  name: string;
  monthly: string;
  scans: string;
  note?: string;
  cta: { label: string; to: string };
}

const WAITLIST_CTA = { label: "Join the waitlist", to: `#${WAITLIST_ID}` };
// MPC-7502: names and prices come from public.plans (src/data/plans.generated.json); paid = any plan that costs money.
const PAID_PLANS = PLAN_ROWS.filter((p) => p.monthly_price_cents > 0).map((p) => p.name);

const FAQS: { q: string; a: string }[] = [
  {
    q: "Can I pay today?",
    a: "Not yet. Paid plans are not open, so no payment is taken and we do not ask for card details. Join the waitlist and we will email you when they open.",
  },
  {
    q: "Can I cancel anytime?",
    a: "There is nothing to cancel yet. Joining the waitlist is not a purchase or a commitment, and you can unsubscribe from our emails at any time.",
  },
  {
    q: "What data do you keep if I join the waitlist?",
    a: "Your email address, the plan you are interested in, and a record of the consent you gave (date and where you gave it). We use them to tell you when paid plans open. Our Privacy Policy describes how that information is processed and your rights.",
  },
  {
    q: "What would paid removal look like?",
    a: "Paid plans are still only planned and not open. We are designing them around three things: clear terms and an easy way to stop before any card details are taken, a way for you to check for yourself afterwards that your information is gone, and a list of the sites we would contact on your behalf. None of this is available yet, and no payment is taken now.",
  },
  {
    q: "Are the prices final?",
    a: "They are the planned monthly prices in US dollars. Scan allowances may change before paid plans open.",
  },
];

const PLANS: Plan[] = PLAN_ROWS.map((p) => ({
  name: p.name,
  scans: p.scans_label,
  note: p.note ?? undefined,
  monthly: formatMonthlyPrice(p.monthly_price_cents),
  cta: p.monthly_price_cents === 0 ? { label: "Check my exposure", to: "/scan" } : WAITLIST_CTA,
}));

// MPC-7638: A/B tests (docs/ab-testing.md). Every variant string below is truthful for a page with no
// checkout yet; the trust line makes no claim beyond what the Free plan already states.
const HEADLINE = {
  control: { h1: "Pricing", sub: "The scan is free. Paid plans are planned to remove your data from brokers and keep it off; they are not open yet." },
  free_first: { h1: "Know your exposure for free. Removal is planned.", sub: "Paid plans are planned to remove your data from brokers and keep it off; they are not open yet." },
} as const;
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
  const liveVariants = Object.fromEntries(live.map((id) => [id, assignments[id].variantId]));
  const copy = HEADLINE[headline.variantId as keyof typeof HEADLINE] ?? HEADLINE.control;
  // The paid buttons wrap (whitespace-normal): "Notify me when plans open" is wider than the card button at lg.
  const paidLabel = cta.variantId === "notify_text" ? "Notify me when plans open" : WAITLIST_CTA.label;
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState(PAID_PLANS[0]);
  const [consent, setConsent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [consentError, setConsentError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);
  const { status, error: errorMsg, submit } = useLeadSubmit(`/thank-you?source=${SOURCE_TAG}`);
  const emailSuggestion = suggestEmail(email);

  useEffect(() => {
    trackPricingView();
    live.forEach((id) => trackExperimentExposure(id, assignments[id].variantId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "error") trackFormSubmitError("pricing_waitlist");
  }, [status]);

  const choosePlan = (p: Plan) => {
    trackPricingPlanClick(p.name.toLowerCase(), p.cta.to, liveVariants);
    live.forEach((id) => trackExperimentCta(id, assignments[id].variantId));
    if (p.cta.to.startsWith("#")) {
      if (PAID_PLANS.includes(p.name)) setPlan(p.name);
      document.getElementById(WAITLIST_ID)?.scrollIntoView?.({ behavior: "smooth" });
      emailRef.current?.focus({ preventScroll: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading" || status === "success") return;

    const emailProblem = validateEmail(email);
    const consentProblem = consent ? "" : "Tick the box to confirm you're happy to hear from us.";
    setEmailError(emailProblem ?? "");
    setConsentError(consentProblem);
    if (emailProblem || consentProblem) {
      trackFormValidationError("pricing_waitlist", emailProblem ? "email" : "consent");
      (emailProblem ? emailRef.current : consentRef.current?.querySelector("input"))?.focus();
      return;
    }

    await submit(
      () =>
        submitHubSpotForm({
          formId: FORM_ID,
          fields: {
            email: email.trim(),
            plan_interest: plan.toLowerCase(),
            // The plan is also in source_tag because HubSpot has not been saving plan_interest from this form.
            source_tag: `${SOURCE_TAG}-${plan.toLowerCase()}`,
            ...consentFields("pricing_waitlist"),
          },
          pageName: "Pricing",
        }),
      () => trackPricingWaitlistSignup(plan.toLowerCase(), liveVariants),
    );
  };

  return (
  <>
    <Seo {...pageMeta["/pricing"]} path="/pricing" />
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-foreground">{copy.h1}</h1>
        <p className="mb-4 text-lg text-muted-foreground">{copy.sub}</p>
        <p className="mb-10 text-sm text-muted-foreground">
          Paid plans are not open yet. Prices below are the planned prices; join the waitlist
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
              {plan.cta.to.startsWith("#") ? (
                <Button
                  type="button"
                  variant={cta.variantId === "outline" ? "outline" : "default"}
                  className="h-auto min-h-10 whitespace-normal py-2 text-center"
                  onClick={() => choosePlan(plan)}
                >
                  {paidLabel}
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link to={plan.cta.to} onClick={() => choosePlan(plan)}>
                    {plan.cta.label}
                  </Link>
                </Button>
              )}
            </section>
          ))}
        </div>
        {proof.variantId === "below_plans" && <div className="mt-6"><TrustLine /></div>}

        <section id={WAITLIST_ID} aria-labelledby="waitlist-heading" className="mt-12 rounded-lg border border-border p-6">
          <h2 id="waitlist-heading" className="mb-2 text-xl font-semibold text-foreground">Join the waitlist</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Tell us which plan you want and we will email you when paid plans open. No payment is taken now.
          </p>
          <form onSubmit={handleSubmit} noValidate className="max-w-md space-y-4">
            <div>
              <label htmlFor="waitlist-email" className="mb-1.5 block text-sm font-medium">Email</label>
              <Input
                id="waitlist-email"
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError("");
                }}
                onBlur={() => email && setEmailError(validateEmail(email) ?? "")}
                required
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "waitlist-email-error" : undefined}
                className={`h-11 ${emailError ? "border-destructive" : ""}`}
              />
              {emailError && <p id="waitlist-email-error" role="alert" className="mt-1.5 text-xs text-destructive">{emailError}</p>}
              {!emailError && emailSuggestion && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Did you mean{" "}
                  <button type="button" onClick={() => setEmail(emailSuggestion)} className="text-foreground underline">{emailSuggestion}</button>?
                </p>
              )}
            </div>
            <div>
              <label htmlFor="waitlist-plan" className="mb-1.5 block text-sm font-medium">Plan</label>
              <select
                id="waitlist-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {PAID_PLANS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div ref={consentRef}>
              <ConsentCheckbox
                id="waitlist-consent"
                checked={consent}
                onChange={(v) => {
                  setConsent(v);
                  if (v) setConsentError("");
                }}
                disabled={status === "loading" || status === "success"}
              />
            </div>
            {consentError && <p role="alert" className="text-xs text-destructive">{consentError}</p>}
            {status === "error" && <p role="alert" className="border-l-4 border-destructive pl-3 text-xs text-foreground">{errorMsg}</p>}
            <SubmitButton status={status} idle="Join the waitlist" loading="Joining..." success="You're on the list" />
          </form>
        </section>

        <section aria-labelledby="pricing-faq-heading" className="mt-12">
          <h2 id="pricing-faq-heading" className="mb-4 text-xl font-semibold text-foreground">Questions</h2>
          <dl className="space-y-4">
            {FAQS.map((f) => (
              <div key={f.q}>
                <dt className="font-medium text-foreground">{f.q}</dt>
                <dd className="text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="family-plan" className="mt-12 rounded-lg border border-border p-6">
          <h2 id="family-plan" className="mb-2 text-xl font-semibold text-foreground">Family members on Pro and Executive</h2>
          <p className="text-muted-foreground">
            Add up to 4 family members for $5/month each, on one subscription. Everyone gets their own scan history,
            reports and monitoring. You can see the reports of children on your plan; adults keep their reports private from each other.
          </p>
        </section>

        <section className="mt-6 rounded-lg bg-muted p-6">
          <h2 className="mb-2 text-xl font-semibold text-foreground">For teams and businesses</h2>
          <p className="mb-4 text-muted-foreground">
            Protecting staff or executives? Tell us about your team and we will put a quote together.
          </p>
          <Button asChild variant="outline">
            <Link to="/business" onClick={() => trackPricingPlanClick("business", "/business", liveVariants)}>Talk to us about business plans</Link>
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
