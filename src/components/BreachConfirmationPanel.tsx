import { useHexagonState } from '@/hooks/useHexagonState';
import { InteractiveHexagonTile } from '@/components/InteractiveHexagonTile';
import type { Hexagon } from '@/types/hexagon';
import type { LearningSignal } from '@/lib/identityConfirmation';

interface Props {
  findings: Hexagon[];
  onLearningSignal?: (s: LearningSignal) => void;
}

// Presentational: shows email breach findings and lets the user answer "Is this you?". Only the findings the user
// owns up to (or the engine is sure of) count toward the number shown. Not mounted on a public page yet.
export default function BreachConfirmationPanel({ findings, onLearningSignal }: Props) {
  const { scanResult, scoredHexagons, handleConfirm, handleDispute } = useHexagonState({ hexagons: findings }, onLearningSignal);
  if (findings.length === 0) return null;
  const waiting = scanResult.hexagons.filter((h) => h.status === 'guess').length;

  return (
    <section className="w-full max-w-xl mx-auto my-6 rounded-2xl border border-surface-border bg-surface p-4 sm:p-6" aria-labelledby="breach-confirm-title">
      <h2 id="breach-confirm-title" className="text-lg font-semibold text-foreground">Email breaches linked to you</h2>
      <p className="text-sm text-muted-foreground mt-1">
        {waiting > 0 ? `${waiting} to confirm. Tap a pulsing tile and tell us if it is you.` : 'All answered.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {scanResult.hexagons.map((h) => (
          <InteractiveHexagonTile key={h.id} hexagon={h} onConfirm={handleConfirm} onDispute={handleDispute} />
        ))}
      </div>
      <p className="mt-4 text-sm text-foreground" data-testid="breach-count">
        {scoredHexagons.length} exposure{scoredHexagons.length === 1 ? '' : 's'} counted
      </p>
    </section>
  );
}
