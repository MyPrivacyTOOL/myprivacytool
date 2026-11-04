// MPC-7471-F2: the scan total in user-facing count copy must come from the registry (shared/hexagon-registry/counts.js), never a typed number.
// Narrow on purpose: only the files that carry the count line, only code lines that are not comments. 46, 52 and 54 stay legitimate
// anywhere else (registry data, fixtures, unrelated thresholds); a legitimate use in these files needs a registry-derived value instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const FILES = [
  'src/components/RiskScore.tsx',
  'src/components/EmailCaptureModal.tsx',
  'src/components/FinalSummaryPanel.tsx',
  'shared/hexagon-registry/counts.js',
];
const HISTORICAL_TOTAL = /\b(46|52|54)\b/;
const COPY_WORD = /data points?|hexagons?|in this scan|in total|things your browser/i;

// A number counts only where it sits in a string or in JSX text that also talks about hexagons or data points.
function offenders(src: string): string[] {
  return src.split('\n').filter((line, i, all) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    if (!HISTORICAL_TOTAL.test(line)) return false;
    const inText = /(['"`>])[^'"`<]*\b(46|52|54)\b/.test(line) || /\b(46|52|54)\b[^'"`<]*(['"`<])/.test(line);
    return inText && (COPY_WORD.test(line) || COPY_WORD.test(all[i - 1] ?? '') || COPY_WORD.test(all[i + 1] ?? ''));
  });
}

describe('no typed scan total in the count copy', () => {
  it.each(FILES)('%s has no 46, 52 or 54 in user-facing copy', (file) => {
    expect(offenders(readFileSync(join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('the detector would catch one (so the check itself is not empty)', () => {
    expect(offenders('<p>All 52 hexagons analyzed</p>')).toHaveLength(1);
    expect(offenders('const t = `${n} of 54 data points confirmed`;')).toHaveLength(1);
    expect(offenders('// was 46 data points')).toHaveLength(0);
    expect(offenders('if (visibleCount <= 52) return x;')).toHaveLength(0); // a threshold, not copy
  });
});
