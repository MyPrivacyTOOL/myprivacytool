// MPC-8452 option A: the live thank-you replays the scan the visitor already ran in this browser. Nothing new is checked and nothing is
// sent. The status of each hexagon was decided at capture (webScan.toPayload -> captureStatus) and is read here, never re-decided.
// A value, a score or a percentage is never shown; an unknown status is "not checked", never "clear".

export type LiveStatus = 'clear' | 'found' | 'guess' | 'not_checked';

export interface LiveCell {
  id: string;
  label: string;
  status: LiveStatus;
}

export interface LiveCounts {
  clear: number;
  found: number;
  guess: number;
  notChecked: number;
}

// DRAFT COPY, owner and Chris sign-off pending (docs/thank-you-live-design-mpc-8452.md section 4). Alice speaks British English, plain words.
export const LIVE_COPY = {
  thanks: 'Thank you. Your report is on its way to your inbox.',
  curtain: 'Let me draw back the curtain.',
  start: "I'll show you what your browser told every website, and how we know each thing.",
  halfway: "Some of these say they weren't checked. For those I make no claim, and I won't guess.",
  done: "That's everything I checked. The full report is in your inbox, with what to change first.",
  noScan: "You haven't run the free scan in this browser yet. Your report email is still coming. Want me to show you?",
  noScanLink: 'Run the free scan',
  imageAlt: 'Alice drawing back a curtain on a wall of green code',
  waiting: 'waiting',
} as const;

export const STATUS_WORDS: Record<LiveStatus, string> = {
  clear: 'Checked and clear',
  found: 'Found',
  guess: 'Our guess',
  not_checked: 'Not checked',
};

// Glyphs so colour is never the only clue.
export const STATUS_GLYPH: Record<LiveStatus, string> = { clear: '✓', found: '!', guess: '?', not_checked: '–' };

/** The saved-scan payload (pendingScan) as display cells. Entries without a usable id or label are dropped. */
export function liveCells(scan: Record<string, unknown>[] | null): LiveCell[] {
  if (!scan) return [];
  const out: LiveCell[] = [];
  for (const h of scan) {
    const id = typeof h.id === 'string' ? h.id : '';
    if (!id) continue;
    const label = typeof h.label === 'string' && h.label ? h.label : id;
    let status: LiveStatus = 'not_checked';
    if (h.status === 'CHECKED_AND_CLEAR') status = 'clear';
    else if (h.status === 'FOUND') status = h.estimate === true ? 'guess' : 'found';
    out.push({ id, label, status });
  }
  return out;
}

/** Counts of the cells shown so far. There is no score and no percentage. */
export function liveCounts(cells: readonly LiveCell[]): LiveCounts {
  const c: LiveCounts = { clear: 0, found: 0, guess: 0, notChecked: 0 };
  for (const cell of cells) {
    if (cell.status === 'clear') c.clear++;
    else if (cell.status === 'found') c.found++;
    else if (cell.status === 'guess') c.guess++;
    else c.notChecked++;
  }
  return c;
}

export function liveSummary(c: LiveCounts): string {
  return `${c.clear} checked and clear, ${c.found} found, ${c.guess} our guess, ${c.notChecked} not checked.`;
}
