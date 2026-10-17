import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Hexagon from './Hexagon';
import HexagonGrid from './HexagonGrid';
import { toTile } from '@/lib/hexagonTile';
import type { HexagonData } from '@/lib/deviceDetection';

vi.mock('./VoiceAI', () => ({ default: () => null }));
vi.mock('./RiskScore', () => ({ default: () => null }));
vi.mock('./LanguageIntelligencePanel', () => ({ default: () => null }));
vi.mock('./FingerprintPanel', () => ({ default: () => null }));
vi.mock('./StoragePanel', () => ({ default: () => null }));
vi.mock('./SocialAccountsPanel', () => ({ default: () => null }));
vi.mock('./SecurityPanel', () => ({ default: () => null }));
vi.mock('./BehaviorPanel', () => ({ default: () => null }));
vi.mock('./FinalSummaryPanel', () => ({ default: () => null }));
vi.mock('./DNSLeakFixGuide', () => ({ default: () => null }));
vi.mock('@/lib/behaviorDetection', () => ({
  startBehaviorTracking: vi.fn(),
  stopBehaviorTracking: vi.fn(),
  getAllBehaviorData: vi.fn(() => ({})),
}));
const trackHexagonConfirm = vi.fn();
vi.mock('@/lib/analytics', () => ({
  trackHexagonConfirm: (...a: unknown[]) => trackHexagonConfirm(...a),
  trackDeepScanUnlocked: vi.fn(),
  trackFunnelStep: vi.fn(),
  trackScanCompleted: vi.fn(),
  trackHexagonAccuracy: vi.fn(),
  trackTimeToFirstConfirmation: vi.fn(),
  trackActivity: vi.fn(),
  trackScanStarted: vi.fn(),
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); trackHexagonConfirm.mockClear(); });

const hex = (over: Partial<HexagonData>): HexagonData => ({
  id: 'device', label: 'Device Type', value: 'Desktop (Windows 11)', icon: '💻', confidence: 92, risk: 'r', confirmed: false, category: 'device', ...over,
});
const noop = () => {};

describe('Hexagon tile rendering', () => {
  it('verified: label, glyph, word + bar, and no bare percentage', () => {
    const d = hex({});
    render(<Hexagon data={d} tile={toTile(d)} onConfirm={noop} onHover={noop} />);
    const b = screen.getByRole('button');
    expect(b.getAttribute('aria-label')).toMatch(/We checked/);
    expect(b.getAttribute('aria-label')).not.toMatch(/%/);
    expect(screen.getByTestId('tile-confidence')).toHaveTextContent('sure');
    expect(b.textContent).not.toMatch(/92%/);
  });

  it('inferred: hatched fill and "looks like"', () => {
    const d = hex({ confidence: 55 });
    const { container } = render(<Hexagon data={d} tile={toTile(d)} onConfirm={noop} onHover={noop} />);
    expect(container.querySelector('path[fill^="url(#hatch-"]')).not.toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/Looks like/);
  });

  it('unknown: no value, no number, no bar, no clean wording, anywhere including aria-label', () => {
    const d = hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', confidence: 100 });
    const { container } = render(<Hexagon data={d} tile={toTile(d)} onConfirm={noop} onHover={noop} />);
    const b = screen.getByRole('button');
    const text = `${b.textContent} ${b.getAttribute('aria-label')}`;
    expect(text).not.toMatch(/100|%|No Leak|clean|safe|secure/i);
    expect(text).toMatch(/Can't see this from a web page/);
    expect(screen.queryByTestId('tile-confidence')).toBeNull();
    expect(container.querySelector('path[fill^="url(#hexGradient"]')).toBeNull();
  });

  it('without a tile the old rendering is unchanged', () => {
    const d = hex({});
    render(<Hexagon data={d} onConfirm={noop} onHover={noop} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/Confidence: 92%/);
  });
});

const grid = (): HexagonData[] => [
  hex({ id: 'dns-leak', label: 'DNS Leak', value: 'Leak', confidence: 100, category: 'security' }),
  hex({ id: 'device', label: 'Device Type' }),
  hex({ id: 'browser', label: 'Browser', value: 'Chrome 141', confidence: 90 }),
  hex({ id: 'screen', label: 'Screen', value: '1920x1080', confidence: 60 }),
  hex({ id: 'time', label: 'Time', value: '10:00', confidence: 90 }),
  hex({ id: 'isp', label: 'ISP', value: 'Check failed', confidence: 100, category: 'network' }),
];

describe('HexagonGrid with VITE_HEXAGON_TILES on', () => {
  it('shows three integers, no ratio, and sorts cannot-check tiles last', () => {
    vi.stubEnv('VITE_HEXAGON_TILES', 'true');
    render(<HexagonGrid hexagons={grid()} />);
    const sum = screen.getByTestId('board-summary');
    expect(sum).toHaveTextContent(/\d+ verified · 0 fixes you told us about · \d+ not yet checked/);
    expect(sum.textContent).not.toMatch(/%|\//);
    expect(screen.queryByRole('progressbar')).toBeNull();
    // 5 visible at the start: dns-leak (cannot check) is sorted after the rest, so it is not among them
    expect(screen.queryByLabelText(/^DNS Leak/)).toBeNull();
  });

  it('a tap counts as "seen": no confidence change, still counts toward reveal, event carries the class', () => {
    vi.stubEnv('VITE_HEXAGON_TILES', 'true');
    render(<HexagonGrid hexagons={grid()} />);
    const device = () => screen.getByLabelText(/^Device Type/);
    expect(device().getAttribute('aria-label')).toMatch(/pretty sure/); // confidence 92
    fireEvent.click(device());
    expect(screen.getByTestId('confirmation-counter')).toHaveTextContent('Seen: 1');
    // the old +5 would make 97 = "sure"; it must stay 92 = "pretty sure"
    expect(device().getAttribute('aria-label')).toMatch(/Seen/);
    expect(device().getAttribute('aria-label')).toMatch(/pretty sure/);
    expect(trackHexagonConfirm).toHaveBeenCalledWith('device', 'Device Type', true, 'verified');
  });

  it('tapping an unknown tile still counts toward reveal and reports class unknown, without changing it', () => {
    vi.stubEnv('VITE_HEXAGON_TILES', 'true');
    render(<HexagonGrid hexagons={grid()} />);
    const isp = () => screen.getByLabelText(/^ISP/);
    fireEvent.click(isp());
    expect(screen.getByTestId('confirmation-counter')).toHaveTextContent('Seen: 1');
    expect(isp().getAttribute('aria-label')).toMatch(/Not known/);
    expect(isp().getAttribute('aria-label')).not.toMatch(/\d+%/);
    expect(trackHexagonConfirm).toHaveBeenCalledWith('isp', 'ISP', true, 'unknown');
  });

  it('with the flag off the old counter, progress bar and +5 behaviour are unchanged', () => {
    render(<HexagonGrid hexagons={grid()} />);
    expect(screen.getByTestId('confirmation-counter')).toHaveTextContent('0/5');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
