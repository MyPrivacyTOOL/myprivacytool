import { useCallback, useState } from "react";
import { SCAN_API_URL } from "@/lib/webScan";

export type HexagonUserAction = "confirmed" | "rejected" | "disputed";

export interface InteractionMeta {
  originalConfidenceScore?: number;
  osintSource?: string;
}

/** Sends one interaction to the backend. Never throws: a network or server failure resolves to false. */
export async function sendHexagonInteraction(
  scanSessionId: string,
  hexagonId: string,
  action: HexagonUserAction,
  meta: InteractionMeta = {},
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${SCAN_API_URL}/api/scan/hexagon-interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scan_session_id: scanSessionId,
        hexagon_id: hexagonId,
        user_action: action,
        ...(meta.originalConfidenceScore !== undefined && { original_confidence_score: meta.originalConfidenceScore }),
        ...(meta.osintSource && { osint_source: meta.osintSource }),
      }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Per-hexagon confirm / reject / dispute state. The UI updates at once (optimistic); the backend call is best effort and a failure
 * (offline, 403 for an unbound session) never reverts or blocks the UI. Without a scanSessionId nothing is sent.
 */
export function useHexagonState(scanSessionId?: string) {
  const [actions, setActions] = useState<Record<string, HexagonUserAction>>({});

  const record = useCallback(
    (hexagonId: string, action: HexagonUserAction, meta?: InteractionMeta) => {
      setActions((prev) => ({ ...prev, [hexagonId]: action }));
      if (scanSessionId) void sendHexagonInteraction(scanSessionId, hexagonId, action, meta);
    },
    [scanSessionId],
  );

  return {
    actions,
    confirm: (id: string, meta?: InteractionMeta) => record(id, "confirmed", meta),
    reject: (id: string, meta?: InteractionMeta) => record(id, "rejected", meta),
    dispute: (id: string, meta?: InteractionMeta) => record(id, "disputed", meta),
  };
}
