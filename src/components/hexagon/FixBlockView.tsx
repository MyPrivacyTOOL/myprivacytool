import { FIX_COPY_IS_DRAFT, regionTextFor, type FixBlock } from '@/lib/hexagonFix';
import { JURISDICTIONS } from '@/lib/hexagonFix';
import { JURISDICTION_LABELS, useDeclaredJurisdiction } from '@/lib/declaredJurisdiction';

// MPC-8745: one typed fix block (MPC-8733) as the visitor sees it. The region text comes only from the jurisdiction the visitor picks here.
export default function FixBlockView({ block }: { block: FixBlock }) {
  const [jurisdiction, setJurisdiction] = useDeclaredJurisdiction();
  const id = `jurisdiction-${block.hexagon_id}`;
  return (
    <div data-testid="fix-block">
      <p className="text-sm text-foreground mt-1">{block.why}</p>
      <ol className="list-decimal pl-5 mt-2 space-y-1 text-sm text-foreground">
        {block.instruction.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {block.region && (
        <div className="mt-3 rounded-lg border border-surface-border p-3" data-testid="fix-region">
          <label htmlFor={id} className="block text-xs text-muted-foreground mb-1">
            Which place's privacy rules apply to you? You choose; we never guess.
          </label>
          <select
            id={id}
            value={jurisdiction ?? ''}
            onChange={(e) => setJurisdiction(e.target.value || null)}
            className="w-full rounded-md border border-surface-border bg-background px-2 py-1 text-sm"
          >
            <option value="">Prefer not to say</option>
            {JURISDICTIONS.map((j) => <option key={j} value={j}>{JURISDICTION_LABELS[j]}</option>)}
          </select>
          <p className="text-sm text-foreground mt-2" data-testid="fix-region-text">{regionTextFor(block.region, jurisdiction)}</p>
        </div>
      )}
      {(FIX_COPY_IS_DRAFT || block.copy_status === 'draft') && (
        <p className="text-xs text-muted-foreground mt-2" data-testid="fix-draft-note">Draft wording.</p>
      )}
    </div>
  );
}
