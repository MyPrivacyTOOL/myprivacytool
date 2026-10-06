import { useEffect, useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, Check, Code2, FileText, HelpCircle, ScanLine, ShieldCheck } from "lucide-react";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { trackThankYouNextStep, trackThankYouView } from "@/lib/analytics";

// Where visitors land after a successful HubSpot submit (MPC-7400). `?source=` picks the copy; anything
// unknown falls back to the generic message. Copy only states what the product does today.

// Set VITE_WELCOME_EMAIL_LIVE=true once the HubSpot welcome workflow is switched on
// (docs/welcome-email-mpc-7400.md). Until then the page does not claim an email has been sent.
const WELCOME_EMAIL_LIVE = import.meta.env.VITE_WELCOME_EMAIL_LIVE === "true";

// Set VITE_DEVELOPER_DOCS_URL when the public developer docs (MPC-7250) have a home; the link is hidden until then.
const DEVELOPER_DOCS_URL = import.meta.env.VITE_DEVELOPER_DOCS_URL as string | undefined;

interface SourceCopy {
  title: string;
  body: string;
}

const COPY: Record<string, SourceCopy> = {
  start: {
    title: "You're on the list.",
    body: "Thanks. We'll email you when your free privacy report is ready. We only use your email for that, and you can unsubscribe at any time.",
  },
  "ai-access-check": {
    title: "You're on the waitlist.",
    body: "Thanks. We'll email you when the full AI Access report opens up. We only use your email for that, and you can unsubscribe at any time.",
  },
  contact: {
    title: "Message sent.",
    body: "Thanks for getting in touch. We'll reply to the email address you gave us.",
  },
};

const GENERIC: SourceCopy = {
  title: "Thanks, you're all set.",
  body: "We've got your details. You can unsubscribe from our emails at any time.",
};

interface NextStep {
  to: string;
  external?: boolean;
  icon: typeof ScanLine;
  title: string;
  body: string;
  key: string;
}

const NEXT_STEPS: NextStep[] = [
  { key: "scan", to: "/?utm_source=thank-you&utm_medium=onboarding&utm_campaign=mpc-7400", icon: ScanLine, title: "See your digital shadow", body: "Run the free scan. It takes about three minutes and runs in your browser." },
  { key: "opt-out-guides", to: "/opt-out-guides", icon: BookOpen, title: "Remove your data yourself", body: "Step-by-step opt-out guides for data brokers, free to follow today." },
  { key: "faq", to: "/faq", icon: HelpCircle, title: "How it works", body: "Answers on what the scan sees and what stays in your browser." },
];

const TRUST_LINKS = [
  { key: "privacy", to: "/privacy", label: "Privacy Policy" },
  { key: "cookies", to: "/cookies", label: "Cookie Policy" },
  { key: "terms", to: "/terms", label: "Terms" },
  { key: "about", to: "/about", label: "About us" },
];

export default function ThankYou() {
  const [params] = useSearchParams();
  const location = useLocation();
  const source = params.get("source") ?? "";
  const copy = COPY[source] ?? GENERIC;
  const knownSource = source in COPY ? source : "other";
  // Variant of any experiment the visitor converted under, handed over by the form via router state.
  const variant = useMemo(() => {
    const v = (location.state as { variant?: string } | null)?.variant;
    return typeof v === "string" ? v.slice(0, 40) : undefined;
  }, [location.state]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    trackThankYouView(knownSource, variant ? { variant_id: variant } : undefined);
  }, [knownSource, variant]);

  const onStep = (destination: string) => () => trackThankYouNextStep(knownSource, destination);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/thank-you"]} path="/thank-you" />

      <section className="max-w-2xl mx-auto px-6 pt-16 pb-8 text-center">
        <div className="w-14 h-14 rounded-full bg-background border border-brand flex items-center justify-center mx-auto mb-5 motion-safe:animate-scale-in">
          <Check className="text-brand" size={26} aria-hidden="true" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold mb-3" tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>
          {copy.title}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed max-w-xl mx-auto">{copy.body}</p>
        {WELCOME_EMAIL_LIVE && knownSource !== "contact" && (
          <p className="text-muted-foreground text-sm mt-3">
            A welcome email is on its way. If you don't see it in a few minutes, check your spam folder.
          </p>
        )}
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-10" aria-labelledby="next-steps-heading">
        <h2 id="next-steps-heading" className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 text-center">
          While you wait
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {NEXT_STEPS.map(({ key, to, icon: Icon, title, body }) => (
            <Link
              key={key}
              to={to}
              onClick={onStep(key)}
              className="group bg-surface border border-surface-border border-t-2 border-t-brand rounded-xl p-5 hover:border-brand/60 transition-colors"
            >
              <Icon className="text-brand mb-3" size={22} aria-hidden="true" />
              <h3 className="text-sm font-bold mb-1.5 flex items-center gap-1.5">
                {title}
                <ArrowRight size={14} className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 motion-safe:transition-all" aria-hidden="true" />
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-20" aria-labelledby="trust-heading">
        <div className="bg-surface border border-surface-border rounded-xl p-5">
          <h2 id="trust-heading" className="text-sm font-bold mb-2 flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand" aria-hidden="true" /> How we handle your data
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed mb-4">
            The scan runs in your browser and its results aren't stored on our servers. We only keep what you choose to
            submit, such as your email address, and we use analytics only with your consent.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {TRUST_LINKS.map(({ key, to, label }) => (
              <li key={key}>
                <Link to={to} onClick={onStep(key)} className="underline hover:text-foreground text-muted-foreground inline-flex items-center gap-1">
                  <FileText size={12} aria-hidden="true" /> {label}
                </Link>
              </li>
            ))}
            {DEVELOPER_DOCS_URL && (
              <li>
                <a
                  href={DEVELOPER_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onStep("developer-docs")}
                  className="underline hover:text-foreground text-muted-foreground inline-flex items-center gap-1"
                >
                  <Code2 size={12} aria-hidden="true" /> Developer docs
                </a>
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
