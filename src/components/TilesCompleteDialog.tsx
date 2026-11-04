// MPC-7471-F1 follow-up: the one scan-complete dialog for the honest-tiles mode (hex_v2). FinalSummaryPanel, which opens the dialog for the
// classic flow, is not shown in this mode, so without this a visitor who finished the scan got no congratulations and no email form.
// Same dialog, same header and same form; the result line is the counts-only risk profile (MPC-7916: no score, percentage, "N of M" or
// Low / Medium / High). Opens once with the completion and never reopens after the visitor closes it.
import { useMemo, useState } from 'react';
import EmailCaptureModal from '@/components/EmailCaptureModal';
import { riskProfile, riskProfileParts, type HexagonTile } from '@/lib/hexagonTile';

export default function TilesCompleteDialog({ tiles }: { tiles: Map<string, HexagonTile> }) {
  const [open, setOpen] = useState(true);
  const board = useMemo(() => riskProfile([...tiles.values()]), [tiles]);
  const parts = useMemo(() => riskProfileParts(board), [board]);
  if (!open) return null;
  return (
    <EmailCaptureModal
      riskScore={null}
      confirmedCount={board.clear}
      profileParts={parts}
      onClose={() => setOpen(false)}
      onSubmit={() => {}}
    />
  );
}
