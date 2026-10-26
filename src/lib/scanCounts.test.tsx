// MPC-7471-F2: confirmed (X), checked (Y) and total (Z) from the registry, the same in every place the line appears.
// Synthetic scans only: no network, no live report, nothing written.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RiskScore from '@/components/RiskScore';
import EmailCaptureModal from '@/components/EmailCaptureModal';
import FinalSummaryPanel from '@/components/FinalSummaryPanel';
import { captureContext, toPayload } from '@/lib/webScan';
import type { HexagonData } from '@/lib/deviceDetection';
import { HEXAGONS, HEXAGON_COUNT } from '../../shared/hexagon-registry/registry.js';
import { scanCounts, scanCountsLine, coverageLine } from '../../shared/hexagon-registry/counts.js';
import { WEB_HEXAGONS, normaliseHexagons, tally } from '../../workers/scan-report/lib/reportHex.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// One value per registry hexagon that the shared status rule reads as FOUND, except where a scenario says otherwise.
const REAL_VALUE = 'Example value 1';
function liveScan(over: Record<string, Partial<HexagonData>> = {}, skip: string[] = []): HexagonData[] {
  return HEXAGONS.filter((h) => !skip.includes(h.id)).map((h) => ({
    id: h.id, label: h.label, value: REAL_VALUE, icon: '•', confidence: 90, risk: 'low', confirmed: false, category: h.category as HexagonData['category'], ...over[h.id],
  }));
}
// A visit like Chris's: some confirmed, one failed check, one hexagon the device never produced, and a battery API that is not there.
const FAILED = 'location'; // placeholder value: a failed lookup, never clear
const MISSING = 'battery'; // not produced on this visit
const CONFIRMED = ['device', 'browser', 'isp', FAILED]; // FAILED is tapped but was not checked: must not count as confirmed
const visit = () => liveScan({ [FAILED]: { value: 'Location detected' }, ...Object.fromEntries(CONFIRMED.map((id) => [id, { confirmed: true, ...(id === FAILED ? { value: 'Location detected' } : {}) }])) }, [MISSING]);

describe('MPC-7471-F2 count contract on the real registry', () => {
  it('Z is the registry total (not a typed number), Y and X follow the status rule, nothing is dropped from Z', () => {
    const c = scanCounts(visit(), { confirmedIds: CONFIRMED, ctx: captureContext(visit()) });
    expect(c.total).toBe(HEXAGON_COUNT);
    expect(c.totalIsFinal).toBe(true);
    expect(c.confirmed).toBe(3); // location was tapped but failed: not confirmed
    expect(c.found + c.clear + c.notChecked + c.pending).toBe(c.total);
    expect(c.checked).toBe(c.found + c.clear);
    expect(c.mismatch.notProducedIds).toEqual([MISSING]); // the registry/scan disagreement is reported, not hidden
    expect(c.notChecked).toBeGreaterThanOrEqual(2); // the failed lookup and the unproduced battery, plus the seven the site cannot check
    expect(c.confirmed).toBeLessThanOrEqual(c.checked);
    expect(c.checked).toBeLessThanOrEqual(c.total);
  });

  it('summary card, popup, share text, saved scan and report email all give the same numbers for one scan', async () => {
    const scan = visit();
    const live = scanCounts(scan, { confirmedIds: CONFIRMED, ctx: captureContext(scan) });
    const line = scanCountsLine(live);

    // saved scan: the payload the visitor's browser would post (no schema change), counted by the same function
    const saved = scanCounts(toPayload(scan.map((h) => ({ ...h, confirmed: CONFIRMED.includes(h.id) })) ) as never);
    expect(saved).toMatchObject({ total: live.total, checked: live.checked, confirmed: live.confirmed, found: live.found, clear: live.clear });

    // report email: its own status adapter and tally, over the same payload
    const t = tally(normaliseHexagons(WEB_HEXAGONS, toPayload(scan)));
    expect(t.total).toBe(live.total);
    expect(t.found + t.clear).toBe(live.checked);

    // summary card
    render(<RiskScore confirmed={3} total={17} counts={live} hexagons={scan} />);
    expect(screen.getByTestId('scan-counts-line')).toHaveTextContent(line);
    cleanup();

    // popup
    render(<EmailCaptureModal riskScore={40} confirmedCount={live.confirmed} counts={live} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.getByTestId('scan-counts-line')).toHaveTextContent(line);
    cleanup();

    // share text, from the summary panel given the same snapshot
    const share = vi.fn();
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<FinalSummaryPanel hexagons={scan} confirmedCount={live.confirmed} counts={live} />);
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0].text).toContain(line);
  });

  it('a different device (battery produced) changes nothing in Z; only checked moves', () => {
    const without = scanCounts(visit(), { ctx: captureContext(visit()) });
    const withBattery = scanCounts(liveScan({ [FAILED]: { value: 'Location detected' } }), { ctx: captureContext(visit()) });
    expect(withBattery.total).toBe(without.total);
    expect(withBattery.checked).toBe(without.checked + 1);
  });

  it('wording keeps coverage apart from risk and from the three-number line', () => {
    const c = scanCounts(visit(), { confirmedIds: CONFIRMED });
    expect(coverageLine(c)).toBe(`${c.checked} of ${c.total} hexagons checked`);
    expect(scanCountsLine(c)).toMatch(/^\d+ of \d+ checked hexagons? confirmed, out of \d+ in this scan$/);
    expect(`${coverageLine(c)} ${scanCountsLine(c)}`).not.toMatch(/risk|probab|likel|safe/i);
  });
});
