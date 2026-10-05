import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "Live" | "Coming soon" | "Roadmap";
type Lane = "you" | "agents";

interface Cta {
  label: string;
  to: string;
}

interface Step {
  id: number;
  lane: Lane;
  name: string;
  tagline: string;
  status: Status;
  happens: string;
  youDo: string;
  youGet: string;
  cta: Cta;
}

const STEPS: Step[] = [
  {
    id: 1,
    lane: "you",
    name: "Know",
    tagline: "See what you look like online",
    status: "Live",
    happens:
      "The free scan checks what your browser and device already reveal about you, so you can see your digital shadow the way a stranger would.",
    youDo: "Run the free scan and confirm which data points are really you.",
    youGet: "A clear picture of your footprint, one hexagon per data point.",
    cta: { label: "Run the free scan", to: "/" },
  },
  {
    id: 2,
    lane: "you",
    name: "Baseline",
    tagline: "Save a starting score",
    status: "Coming soon",
    happens:
      "Your results are scored across the hexagons and saved as a dated snapshot, so there is a fixed starting point to measure against.",
    youDo: "Save your first snapshot after a scan.",
    youGet: "An Identity Baseline: your starting risk score.",
    cta: { label: "Get notified", to: "/newsletter" },
  },
  {
    id: 3,
    lane: "you",
    name: "Erase",
    tagline: "Remove what you don't want out there",
    status: "Live",
    happens:
      "Step-by-step guides walk you through opting out of data brokers and people-search sites. Guided removal comes first; automation follows.",
    youDo: "Follow the opt-out guides for the sites that hold your data.",
    youGet: "Less of your personal data in public, with a before and after score to come.",
    cta: { label: "Open the opt-out guides", to: "/opt-out-guides" },
  },
  {
    id: 4,
    lane: "you",
    name: "Clean baseline",
    tagline: "Get low-risk and keep it that way",
    status: "Coming soon",
    happens:
      "You re-scan until your risk is low, then ongoing monitoring flags anything new that appears.",
    youDo: "Re-scan after cleanup and turn on monitoring.",
    youGet: "A timestamped Clean Baseline you can build on.",
    cta: { label: "Get notified", to: "/newsletter" },
  },
  {
    id: 5,
    lane: "agents",
    name: "Go agentic",
    tagline: "Connect AI tools with the least access",
    status: "Coming soon",
    happens:
      "Every agent you launch inherits your footprint. With a clean baseline, you connect AI tools with only the access they need, each one registered against you.",
    youDo: "Check what your AI tools can already reach, then connect new ones sparingly.",
    youGet: "An inventory of your agents linked to your baseline.",
    cta: { label: "Try the AI access check", to: "/ai-access-check" },
  },
  {
    id: 6,
    lane: "agents",
    name: "Agent footprint",
    tagline: "See what each agent leaves behind",
    status: "Coming soon",
    happens:
      "The same Know, Baseline and Erase loop is applied to each agent: what it can access, what it has shared, and how exposed it is.",
    youDo: "Review each agent's footprint and revoke access you don't need.",
    youGet: "A per-agent footprint and risk score, with alerts when you drift from your clean baseline.",
    cta: { label: "Get notified", to: "/newsletter" },
  },
  {
    id: 7,
    lane: "agents",
    name: "Agent passport",
    tagline: "Prove who your agent works for",
    status: "Roadmap",
    happens:
      "Your verified, low-risk baseline becomes the root of trust for credentials issued to your agents, so others can see who stands behind them.",
    youDo: "Verify yourself once, then issue credentials to your agents.",
    youGet: "Agents that can prove who they work for, while sharing the minimum about you.",
    cta: { label: "Follow progress", to: "/newsletter" },
  },
  {
    id: 8,
    lane: "agents",
    name: "Agent trust",
    tagline: "Check other agents before you deal with them",
    status: "Roadmap",
    happens:
      "Platforms and agents can check a credential and its trust score before transacting, without every check passing through a central gatekeeper.",
    youDo: "Nothing extra. Your agents use it on your behalf.",
    youGet: "Safer interactions between agents acting for you and for others.",
    cta: { label: "Follow progress", to: "/newsletter" },
  },
];

const LANES: { id: Lane; label: string }[] = [
  { id: "you", label: "For you" },
  { id: "agents", label: "For your agents" },
];

const STATUS_STYLE: Record<Status, string> = {
  Live: "bg-[hsl(var(--risk-low-soft))] text-[hsl(var(--risk-low))] border-[hsl(var(--risk-low)/0.3)]",
  "Coming soon":
    "bg-[hsl(var(--risk-mid-soft))] text-[hsl(var(--risk-mid))] border-[hsl(var(--risk-mid)/0.3)]",
  Roadmap: "bg-muted text-muted-foreground border-border",
};

const readHash = (): number => {
  const m = /^#step-(\d+)$/.exec(window.location.hash);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= STEPS.length ? n : 1;
};

const StatusPill = ({ status }: { status: Status }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
      STATUS_STYLE[status],
    )}
  >
    {status}
  </span>
);

const JourneyGuide = () => {
  const [current, setCurrent] = useState<number>(() => readHash());

  useEffect(() => {
    const onHash = () => setCurrent(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id: number) => {
    setCurrent(id);
    window.history.replaceState(null, "", `#step-${id}`);
  };

  const step = STEPS[current - 1];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="grid gap-6 md:grid-cols-2 mb-8">
        {LANES.map((lane) => (
          <div key={lane.id}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand mb-3">
              {lane.label}
            </h2>
            <ol className="grid grid-cols-2 gap-3">
              {STEPS.filter((s) => s.lane === lane.id).map((s) => {
                const active = s.id === current;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => select(s.id)}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "w-full h-full text-left rounded-xl border p-3 transition-colors bg-card",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        active
                          ? "border-primary bg-brand-soft shadow-card"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold mb-2",
                          active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                        )}
                      >
                        {s.id}
                      </span>
                      <span className="block text-sm font-semibold text-foreground">{s.name}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <section
        aria-live="polite"
        aria-labelledby="journey-step-title"
        className="rounded-2xl border border-surface-border bg-surface p-5 sm:p-8 shadow-card"
      >
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <p className="text-sm text-muted-foreground">
            Step {step.id} of {STEPS.length}
          </p>
          <StatusPill status={step.status} />
        </div>
        <h3 id="journey-step-title" className="text-2xl sm:text-3xl font-bold text-foreground">
          {step.name}
        </h3>
        <p className="text-muted-foreground mb-6">{step.tagline}</p>

        <dl className="grid gap-5 sm:grid-cols-3">
          {[
            ["What happens", step.happens],
            ["What you do", step.youDo],
            ["What you get", step.youGet],
          ].map(([label, text]) => (
            <div key={label}>
              <dt className="text-sm font-semibold text-brand mb-1">{label}</dt>
              <dd className="text-sm text-foreground/90 leading-relaxed">{text}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-col gap-4">
          <div
            className="flex gap-1.5"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={current}
            aria-label="Journey progress"
          >
            {STEPS.map((s) => (
              <span
                key={s.id}
                className={cn("h-1.5 flex-1 rounded-full", s.id <= current ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild>
              <Link to={step.cta.to}>{step.cta.label}</Link>
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => select(current - 1)}
                disabled={current === 1}
                className="gap-1"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => select(current + 1)}
                disabled={current === STEPS.length}
                className="gap-1"
              >
                Next step <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default JourneyGuide;
