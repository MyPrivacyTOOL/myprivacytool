// CK-8493: SYNTHETIC ledger rows for tests and the manual review command. Every person key is invented; nothing here comes from a real visitor.
import type { LedgerEvent } from './measure';
import type { Answer } from './aggregate';

export const T0 = Date.UTC(2026, 9, 1);   // 2026-10-01
export const DAY = 24 * 3600 * 1000;

export const person = (prefix: string, i: number) => `${prefix}-synthetic-${String(i).padStart(4, '0')}`.padEnd(16, 'x');

interface Spec { hexagonId: string; source?: string; tileKind: string | null; confidence: number | null; configVersion: number; prefix: string; yes?: number; no?: number; disputed?: number; kept?: number; silent: number; at: number; scanWindow?: string }

/** Builds shown rows for everyone and one answer row for each responder. */
export function cohortEvents(s: Spec): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const answers: Answer[] = [
    ...Array(s.yes ?? 0).fill('yes_me'), ...Array(s.no ?? 0).fill('not_me'), ...Array(s.disputed ?? 0).fill('disputed'), ...Array(s.kept ?? 0).fill('kept'),
  ];
  const n = answers.length + s.silent;
  for (let i = 0; i < n; i++) {
    const base = { personKey: person(s.prefix, i), hexagonId: s.hexagonId, source: s.source ?? 'web-scan', scanWindow: s.scanWindow ?? 'w1', tileKind: s.tileKind, confidenceAtDisplay: s.confidence, configVersion: s.configVersion };
    out.push({ ...base, type: 'shown', at: s.at + i });
    if (i < answers.length) out.push({ ...base, type: 'answer', answer: answers[i], at: s.at + i + 1000 });
  }
  return out;
}
