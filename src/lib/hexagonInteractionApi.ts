import type { LearningOutcome } from '@/lib/identityConfirmation';
import type { Hexagon } from '@/types/hexagon';

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

export interface DeepDiveScan { hexagons: Hexagon[]; finalized: boolean }
export interface FinalScore { verified_exposure_count: number; score: number; confirmed_hexagon_ids: string[]; not_checked_count: number }

async function getJson<T>(path: string, init: RequestInit | undefined, fetchImpl: typeof fetch, base: string): Promise<T | null> {
  if (!base) return null;
  try {
    const res = await fetchImpl(`${base}${path}`, init);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The findings behind a deep-dive link. null = no API configured, unknown or expired scan, or offline. */
export const fetchDeepDiveScan = (scanId: string, fetchImpl: typeof fetch = fetch, base: string = BASE) =>
  getJson<DeepDiveScan>(`/api/scan/deep-dive?scan_id=${encodeURIComponent(scanId)}`, undefined, fetchImpl, base);

/** The server-side verified score for the scan. null on any failure. */
export const fetchFinalScore = (scanId: string, fetchImpl: typeof fetch = fetch, base: string = BASE) =>
  getJson<FinalScore>(`/api/scan/final-risk-score?scan_id=${encodeURIComponent(scanId)}`, undefined, fetchImpl, base);

/** Finish: the server computes the count and sends the WhatsApp summary once. */
export const finalizeDeepDive = (scanId: string, fetchImpl: typeof fetch = fetch, base: string = BASE) =>
  getJson<{ success: boolean; already_sent?: boolean }>('/api/scan/finalize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan_id: scanId }),
  }, fetchImpl, base);
