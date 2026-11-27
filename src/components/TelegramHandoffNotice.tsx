import { useMemo } from 'react';
import { useTelegramHandoff } from '@/lib/telegramHandoff';
import { footprintSummary } from '../../shared/hexagon-registry/footprint.js';

// MPC-8689: shown on arrival from the one-time Telegram link (/?handoff=1), so the person sees the Telegram result was received before the web scan finishes.
// Ids only, held in memory. No valid session, or nothing counted, means no banner and no Telegram claim at all.
export default function TelegramHandoffNotice() {
  const handoff = useTelegramHandoff();
  // Same rule as the footprint line: only ids that are real Telegram hexagons count, so a well-formed but unknown id never produces a claim.
  const counted = useMemo(() => footprintSummary(handoff.ids).byChannel.find((c) => c.key === 'telegram')?.checked ?? 0, [handoff.ids]);
  if (counted === 0) return null;
  const when = handoff.scanAt && !Number.isNaN(Date.parse(handoff.scanAt)) ? ` on ${new Date(handoff.scanAt).toLocaleDateString()}` : '';
  return (
    <div role="status" data-testid="telegram-handoff-notice" className="max-w-2xl mx-auto my-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
      Your Telegram result was received: {counted} Telegram checks from your Telegram scan{when}. They are added to your count when this web scan finishes. Only which checks ran was shared, not your values.
    </div>
  );
}
