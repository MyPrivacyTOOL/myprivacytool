import type { LearningOutcome } from '@/lib/identityConfirmation';

// The deep-dive API (webhook-receiver Worker). Unset = not deployed to a public URL yet = nothing is sent (no guessed host).
const BASE = ((import.meta.env.VITE_DEEP_DIVE_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

const ACTION: Record<LearningOutcome, 'confirm' | 'reject' | 'dispute'> = { confirmed: 'confirm', rejected: 'reject', disputed: 'dispute' };

/**
 * Tells the backend about one answer: POST /api/scan/hexagon-interaction {scan_id, hexagon_id, action}. The server re-checks that the scan
 * belongs to a verified wa_id, applies the same rule, and stores the answer. Never throws: offline, a 4xx or a 5xx resolve to false and
 * the page keeps its own state.
 */
export async function sendHexagonInteraction(
  scanId: string,
  hexagonId: string,
  outcome: LearningOutcome,
  fetchImpl: typeof fetch = fetch,
  base: string = BASE,
): Promise<boolean> {
  if (!base || !scanId) return false;
  try {
    const res = await fetchImpl(`${base}/api/scan/hexagon-interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_id: scanId, hexagon_id: hexagonId, action: ACTION[outcome] }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
