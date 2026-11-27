import { cn } from "@/lib/utils";
import { JOURNEY_STEPS, type FeatureState, type JourneyStepId } from "@/config/featureStatus";

// MPC-9832: badge for one Journey step. Unlike <FeatureStatus>, a live step shows "Live" too, because every one of the
// eight steps carries a true badge. State comes only from JOURNEY_STEPS in src/config/featureStatus.ts.
const JOURNEY_LABEL: Record<FeatureState, string> = { live: "Live", in_build: "In build", planned: "Planned" };
const STYLE: Record<FeatureState, string> = {
  live: "bg-[hsl(var(--risk-low-soft))] text-foreground border-[hsl(var(--risk-low)/0.3)]",
  in_build: "bg-[hsl(var(--risk-mid-soft))] text-[hsl(var(--risk-mid))] border-[hsl(var(--risk-mid)/0.3)]",
  planned: "bg-muted text-muted-foreground border-border",
};

const JourneyStepStatus = ({ step, className }: { step: JourneyStepId; className?: string }) => {
  const state = JOURNEY_STEPS[step];
  return (
    <span
      data-journey-step={step}
      data-journey-state={state}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        STYLE[state],
        className,
      )}
    >
      {JOURNEY_LABEL[state]}
    </span>
  );
};

export default JourneyStepStatus;
