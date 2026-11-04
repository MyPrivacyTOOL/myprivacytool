import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import FinalSummaryPanel from './FinalSummaryPanel';
import { toTile, type HexagonTile } from '@/lib/hexagonTile';
import type { HexagonData } from '@/lib/deviceDetection';

vi.mock('@/components/EmailCaptureModal', () => ({ default: () => null }));

afterEach(cleanup);

const hex = (over: Partial<HexagonData>): HexagonData => ({
  id: 'device', label: 'Device Type', value: 'Desktop (Windows 11)', icon: '💻', confidence: 92, risk: 'r', confirmed: true, category: 'device', ...over,
});
const hexagons: HexagonData[] = [
  hex({}),
  hex({ id: 'browser', label: 'Browser', value: 'Chrome 141', confidence: 90 }),
  hex({ id: 'google-services', label: 'Google Services', value: 'Signed in', confidence: 100, category: 'social' }),
  hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', confidence: 100, category: 'security' }),
];
const tilesFor = (hs: HexagonData[]): Map<string, HexagonTile> => new Map(hs.map((h) => [h.id, toTile(h)]));

describe('FinalSummaryPanel with tiles', () => {
  it('shows counts only and no score, percentage, ratio or uniqueness', () => {
    const { container } = render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} tiles={tilesFor(hexagons)} />);
    const board = screen.getByTestId('final-board-summary');
    expect(board).toHaveTextContent(/need fixing/);
    expect(board).toHaveTextContent(/not checked yet/);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Risk Score|Exposure score|Overall exposure score|Coverage|Uniqueness|Exposure|Export PDF/);
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toMatch(/\d+\/\d+/);
    expect(text).not.toMatch(/Complete analysis|100% Local/);
  });

  it('ignores taps and the raw values of tiles that make no claim', () => {
    const { container } = render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} tiles={tilesFor(hexagons)} />);
    expect(container.textContent).not.toMatch(/Google can track you/);
  });

  it('the local-only notice says when a scan is stored, with and without tiles', () => {
    for (const props of [{ tiles: tilesFor(hexagons) }, {}]) {
      const { container, unmount } = render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} {...props} />);
      const text = container.textContent ?? '';
      expect(text).toMatch(/or save your scan with your email/);
      expect(text).toMatch(/We store your scan result only if you tick the save box with your email\./);
      unmount();
    }
  });

  it('without tiles the shared exposure score, coverage and PDF button are shown', () => {
    const { container } = render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} />);
    expect(container.textContent).toMatch(/Exposure score/);
    expect(container.textContent).toMatch(/Coverage/);
    expect(container.textContent).toMatch(/Export PDF/);
    expect(container.textContent).toMatch(/100% Local/);
  });
});
