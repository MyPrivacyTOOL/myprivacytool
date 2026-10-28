import { FIX_COPY_IS_DRAFT, type FixBlock, type FixStep } from '@/lib/hexagonFix';
import FixBlockView from './FixBlockView';

interface NextStepCardProps {
  label: string;
  step?: FixStep;
  /** MPC-8745: the typed block, when the fix-blocks switch is on. It replaces `step`. */
  block?: FixBlock;
  position: number;
  total: number;
  onDone: () => void;
  onLater: () => void;
}

// MPC-7916 Phase 2: one next step at a time. "I've done this" is the visitor's word ("you told us"), never proof: the tile only
// turns solid green when we check again. "Later" is no response, never a "no".
export default function NextStepCard({ label, step, block, position, total, onDone, onLater }: NextStepCardProps) {
  return (
    <section
      className="max-w-xl mx-auto mb-6 rounded-2xl border-2 border-[hsl(var(--tile-red))] bg-surface p-4 sm:p-5 shadow-card"
      aria-labelledby="next-step-title"
      data-testid="next-step"
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
        Your next step · {position} of {total}
      </p>
      <h3 id="next-step-title" className="text-lg font-semibold text-foreground">{label}</h3>
      {block ? (
        <FixBlockView block={block} />
      ) : step ? (
        <>
          <p className="text-sm text-foreground mt-1">{step.why}</p>
          <ol className="list-decimal pl-5 mt-2 space-y-1 text-sm text-foreground">
            {step.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {FIX_COPY_IS_DRAFT && <p className="text-xs text-muted-foreground mt-2" data-testid="fix-draft-note">Draft wording.</p>}
        </>
      ) : (
        <p className="text-sm text-foreground mt-1" data-testid="no-fix-step">We don't have a fix step for this one yet.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          I've done this
        </button>
        <button
          type="button"
          onClick={onLater}
          className="rounded-lg border border-dashed border-surface-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Later
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        "I've done this" is recorded as what you told us. The hexagon turns solid green only when we check again. Later does not count as a no.
      </p>
    </section>
  );
}
