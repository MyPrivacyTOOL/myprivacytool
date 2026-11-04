import { Button } from '@/components/ui/button';

interface UnknownDeviceHeroProps {
  /** Hexagon id to jump to (a data point we CAN read with certainty). */
  spotlightId: string;
  spotlightLabel: string;
}

/**
 * Shown instead of the device carousel when we cannot be certain what device
 * this is. Being hard to identify is good news for the visitor — and the
 * honest alternative to guessing — so we say so and point at what we CAN see.
 */
export default function UnknownDeviceHero({ spotlightId, spotlightLabel }: UnknownDeviceHeroProps) {
  const jump = () => {
    const el = document.getElementById(`hexagon-${spotlightId}`);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };

  return (
    <div className="w-full max-w-[280px] sm:max-w-xs mx-auto">
      <div className="relative rounded-xl sm:rounded-2xl p-5 sm:p-8 shadow-card border border-surface-border text-center space-y-3"
        style={{ background: 'hsl(var(--surface) / var(--surface-alpha))' }}>
        <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wider">
          Your Device
        </div>
        <div className="text-4xl sm:text-5xl select-none" aria-hidden="true">🕶️</div>
        <div className="text-foreground font-semibold text-base sm:text-lg">
          We can’t be certain what you’re using
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          That’s good for your privacy — we won’t guess. Here’s something we <em>can</em> see:
        </p>
        <Button variant="outline" size="sm" onClick={jump}>
          See your {spotlightLabel} ↓
        </Button>
      </div>
    </div>
  );
}
