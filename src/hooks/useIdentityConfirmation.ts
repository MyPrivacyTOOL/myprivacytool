import { useCallback, useMemo, useState } from 'react';
import {
  IdentityFinding,
  LearningEvent,
  confirmFinding,
  disputeFinding,
  learningEvent,
  riskFindings,
} from '@/lib/findingConfirmation';

/**
 * Holds the findings and applies the person's answers to them.
 * `onLearningEvent` is where the learning loop plugs in. By default the event is only logged to the console
 * (id, source, decision; never the found value). Sending it to a backend is a consent decision (see
 * docs/learning-loop-mpc-7493.md: saved only with the scan-saving consent), so this hook does not do that itself.
 */
const logToConsole = (e: LearningEvent) => console.info('[LEARNING LOOP]', e);

export function useIdentityConfirmation(
  initial: IdentityFinding[],
  onLearningEvent: (e: LearningEvent) => void = logToConsole,
) {
  const [findings, setFindings] = useState<IdentityFinding[]>(initial);

  const apply = useCallback(
    (id: string, transition: (f: IdentityFinding) => IdentityFinding) => {
      const before = findings.find(f => f.id === id);
      if (!before) return;
      const after = transition(before);
      const event = learningEvent(before, after);
      if (!event) return;
      setFindings(prev => prev.map(f => (f.id === id ? after : f)));
      onLearningEvent(event);
    },
    [findings, onLearningEvent],
  );

  const handleConfirm = useCallback((id: string, isMatch: boolean) => apply(id, f => confirmFinding(f, isMatch)), [apply]);
  const handleDispute = useCallback((id: string) => apply(id, disputeFinding), [apply]);

  /** The findings the risk score is built from: false_positive and disputed never appear here. */
  const scoredFindings = useMemo(() => riskFindings(findings), [findings]);

  return { findings, scoredFindings, handleConfirm, handleDispute };
}
