import type { HexagonData } from '@/lib/deviceDetection';
import { scanHint } from '@/lib/scanCopy';

// CK-7805: visible plain-language explanation. On touch there is no hover, so a tap selects a hexagon and this
// stays on screen until another is tapped. The box has ONE fixed height (it scrolls if text is longer); a height that changes with the text made the grid
// jump under the pointer and the hexagon flicker between hover states. The box always takes the same height (hint or explanation) and sits
// above the grid, so showing it never shifts the hexagons and never covers one under the finger.
export default function HexagonExplanation({ hexagon }: { hexagon: HexagonData | null }) {
  const active = hexagon && hexagon.id !== 'revealing' ? hexagon : null;
  return (
    <div
      className="w-full max-w-xl mx-auto mb-4 h-[13.5rem] sm:h-44 overflow-y-auto rounded-2xl border border-surface-border bg-surface shadow-card p-4"
      role="status"
      aria-live="polite"
      data-testid="hexagon-explanation"
    >
      {active ? (
        <>
          <p className="font-semibold text-foreground text-base">
            {active.headline ?? `${active.label}: ${active.displayValue ?? active.value}`}
          </p>
          <p className="text-sm text-foreground mt-1" data-testid="hexagon-explanation-text">
            {active.explanation ?? active.risk}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="hexagon-explanation-hint">
          {scanHint()}
        </p>
      )}
    </div>
  );
}
