import { useCallback, useRef, useState } from 'react';
import type { ScanResult } from '@/types/hexagon';
import {
  confirmHexagon,
  disputeHexagon,
  scoredHexagons,
  type LearningSignal,
  type TransitionResult,
} from '@/lib/identityConfirmation';

/**
 * Holds the scan result and applies the user's confirm / dispute answers.
 * `onLearningSignal` receives one signal per accepted answer (no finding data), for the future backend call.
 */
export const useHexagonState = (initialData: ScanResult, onLearningSignal?: (s: LearningSignal) => void) => {
  const [scanResult, setScanResult] = useState(initialData);
  // Mirror of the latest state, so two quick taps in one tick both see the first answer.
  const latest = useRef(initialData);

  const apply = useCallback(
    (transition: (s: ScanResult) => TransitionResult) => {
      const { next, signal } = transition(latest.current);
      if (!signal) return;
      latest.current = next;
      setScanResult(next);
      // THE LEARNING LOOP: id and outcome only. TODO: POST to the backend to tune provider confidence by region.
      console.info(`[LEARNING LOOP] ${signal.outcome.toUpperCase()} ${signal.hexagonId}`);
      onLearningSignal?.(signal);
    },
    [onLearningSignal],
  );

  const handleConfirm = useCallback(
    (id: string, isMatch: boolean) => apply((s) => confirmHexagon(s, id, isMatch)),
    [apply],
  );
  const handleDispute = useCallback((id: string) => apply((s) => disputeHexagon(s, id)), [apply]);

  return { scanResult, scoredHexagons: scoredHexagons(scanResult), handleConfirm, handleDispute };
};
