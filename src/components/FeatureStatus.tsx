import { cn } from "@/lib/utils";
import { FEATURE_STATUS, CHANNEL_STATUS, type FeatureId, type ChannelId, type FeatureState } from "@/config/featureStatus";

// MPC-9836: inline status marker. Renders nothing once the feature is "live". Text carries the meaning (works without
// colour). Pill style mirrors the Journey StatusPill (JourneyGuide.tsx).
const LABEL = { in_build: "In build", planned: "Planned" } as const;
const STYLE = {
  in_build: "bg-[hsl(var(--risk-mid-soft))] text-[hsl(var(--risk-mid))] border-[hsl(var(--risk-mid)/0.3)]",
  planned: "bg-muted text-muted-foreground border-border",
} as const;

const StatusPill = ({ state, dataKey, className }: { state: FeatureState; dataKey: { "data-feature"?: string; "data-channel"?: string }; className?: string }) => {
  if (state === "live") return null;
  return (
    <span
      data-feature-status={state}
      {...dataKey}
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

// `state` (MPC-9814) pins a marker for a part of a claim that is not live even when its feature is: e.g. F1 live = the free check, paid coverage stays Planned.
const FeatureStatus = ({ feature, className, state: pinned }: { feature: FeatureId; className?: string; state?: "in_build" | "planned" }) => (
  <StatusPill state={pinned ?? FEATURE_STATUS[feature]} dataKey={{ "data-feature": feature }} className={className} />
);

// MPC-9826: marker for a /start channel card, driven by CHANNEL_STATUS. "Live" shows a plain text label so all six states are readable.
export const ChannelStatus = ({ channel, className }: { channel: ChannelId; className?: string }) => (
  <StatusPill state={CHANNEL_STATUS[channel]} dataKey={{ "data-channel": channel }} className={className} />
);

export default FeatureStatus;
