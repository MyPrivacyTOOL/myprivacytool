import { cn } from "@/lib/utils";
import { FEATURE_STATUS, type FeatureId } from "@/config/featureStatus";

// MPC-9836: inline status marker. Renders nothing once the feature is "live". Text carries the meaning (works without
// colour). Pill style mirrors the Journey StatusPill (JourneyGuide.tsx).
const LABEL = { in_build: "In build", planned: "Planned" } as const;
const STYLE = {
  in_build: "bg-[hsl(var(--risk-mid-soft))] text-[hsl(var(--risk-mid))] border-[hsl(var(--risk-mid)/0.3)]",
  planned: "bg-muted text-muted-foreground border-border",
} as const;

const FeatureStatus = ({ feature, className }: { feature: FeatureId; className?: string }) => {
  const state = FEATURE_STATUS[feature];
  if (state === "live") return null;
  return (
    <span
      data-feature-status={state}
      data-feature={feature}
      className={cn(
        "ml-2 inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 align-middle text-xs font-semibold leading-none",
        STYLE[state],
        className,
      )}
    >
      {LABEL[state]}
    </span>
  );
};

export default FeatureStatus;
