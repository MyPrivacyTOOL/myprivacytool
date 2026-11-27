// The behaviour panel and the final summary carry no hard-coded statistic: nothing in the scan measures how unique a visitor is,
// or how much of the web a company covers.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = ['src/components/BehaviorPanel.tsx', 'src/components/FinalSummaryPanel.tsx'];
// A literal number followed by "%" and then words that make it a claim about people, browsers or the web.
const STATISTIC = /\d+(\.\d+)?\s?%\s+(unique|identifiable|trackable|accurate|of\s+(all\s+)?(websites|sites|users|people|browsers))/i;

describe('no invented statistics in behaviour and summary copy', () => {
  it.each(FILES)('%s has no hard-coded percentage claim', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(src).not.toMatch(STATISTIC);
    for (const banned of ['97%', '80% of websites']) expect(src).not.toContain(banned);
  });

  it('the pattern catches the removed lines', () => {
    for (const old of ['Your movement patterns create a 97% unique signature', 'Google can track you across 80% of websites']) {
      expect(old).toMatch(STATISTIC);
    }
  });
});
