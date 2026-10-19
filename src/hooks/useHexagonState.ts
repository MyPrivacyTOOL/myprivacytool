import { useCallback, useRef, useState } from 'react';
import type { ScanResult } from '@/types/hexagon';
import {
  confirmHexagon,
  disputeHexagon,
  scoredHexagons,
  type LearningSignal,
  type TransitionResult,
} from '@/lib/identityConfirmation';
import { sendHexagonInteraction } from '@/lib/hexagonInteractionApi';

/**
 * Holds the scan result and applies the user's confirm / dispute answers.
 * `onLearningSignal` receives one signal per accepted answer (no finding data).
 * With a `scanId` (the deep-dive scan the page was opened for) each accepted answer is also sent to the backend, best effort: the UI has
 * already updated, and a network failure or a refusal changes nothing on screen.
 */
export const useHexagonState = (
  initialData: ScanResult,
  onLearningSignal?: (s: LearningSignal) => void,
  scanId?: string,
) => {
  const [scanResult, setScanResult] = useState(initialData);
  // Mirror of the latest state, so two quick taps in one tick both see the first answer.
  const latest = useRef(initialData);

  const apply = useCallback(
    (transition: (s: ScanResult) => TransitionResult) => {
      const { next, signal } = transition(latest.current);
      if (!signal) return;
      latest.current = next;
      setScanResult(next);
      // THE LEARNING LOOP: the server stores the answer and, for a reject or dispute, tunes the provider. id and action only go out.
      if (scanId) void sendHexagonInteraction(scanId, signal.hexagonId, signal.outcome);
      onLearningSignal?.(signal);
    },
    [onLearningSignal, scanId],
  );

  const handleConfirm = useCallback(
    (id: string, isMatch: boolean) => apply((s) => confirmHexagon(s, id, isMatch)),
    [apply],
  );
  const handleDispute = useCallback((id: string) => apply((s) => disputeHexagon(s, id)), [apply]);

  return { scanResult, scoredHexagons: scoredHexagons(scanResult), handleConfirm, handleDispute };
};
