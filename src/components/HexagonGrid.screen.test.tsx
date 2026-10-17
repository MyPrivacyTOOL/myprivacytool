import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import HexagonGrid from './HexagonGrid';
import type { HexagonData } from '@/lib/deviceDetection';
import * as analytics from '@/lib/analytics';

vi.mock('./VoiceAI', () => ({ default: () => <div data-testid="voice-ai" /> }));
vi.mock('./RiskScore', () => ({ default: () => <div data-testid="risk-score-card">54%</div> }));
vi.mock('./LanguageIntelligencePanel', () => ({ default: () => <div data-testid="panel-language" /> }));
vi.mock('./FingerprintPanel', () => ({ default: () => <div data-testid="panel-fingerprint" /> }));
vi.mock('./StoragePanel', () => ({ default: () => null }));
vi.mock('./SocialAccountsPanel', () => ({ default: () => null }));
vi.mock('./SecurityPanel', () => ({ default: () => null }));
vi.mock('./BehaviorPanel', () => ({ default: () => null }));
vi.mock('./FinalSummaryPanel', () => ({ default: () => <div data-testid="final-summary" /> }));
vi.mock('./DNSLeakFixGuide', () => ({ default: () => null }));
vi.mock('@/lib/behaviorDetection', () => ({
  startBehaviorTracking: vi.fn(),
  stopBehaviorTracking: vi.fn(),
  getAllBehaviorData: vi.fn(() => ({})),
}));
vi.mock('@/lib/analytics', () => ({
  trackHexagonConfirm: vi.fn(),
  trackDeepScanUnlocked: vi.fn(),
  trackFunnelStep: vi.fn(),
  trackHexagonAccuracy: vi.fn(),
  trackTimeToFirstConfirmation: vi.fn(),
  trackActivity: vi.fn(),
  trackScanStarted: vi.fn(),
  trackScanCompleted: vi.fn(),
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const h = (id: string, label: string, value: string, confidence = 99): HexagonData => ({
  id, label, value, icon: '•', confidence, risk: 'risk', confirmed: false, category: 'device',
});
// First five by the interest order: webrtc, canvas, dns, typing, webgl. Then three more.
const makeHexagons = (): HexagonData[] => [
  h('webrtc-leak', 'WebRTC Leak', 'Leaking: 203.0.113.9'),
  h('canvas-fingerprint', 'Canvas Fingerprint', 'Vale Tulip'),
  h('dns-leak', 'DNS Leak', 'No Leak Detected'),
  h('typing-patterns', 'Typing Patterns', 'No input yet', 5),
  h('webgl-fingerprint', 'WebGL Signature', 'Apple graphics'),
  h('location', 'Location', 'Springfield, England', 95),
  h('primary-language', 'Primary Language', 'English (UK)'),
  h('cookies-status', 'Cookies', 'Empty', 100),
];
const tiles = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('data-tile-kind'));

describe('HexagonGrid, one job per screen (MPC-7916 Phase 2)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_HEX_SCREEN_V2', 'true');
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });

  it('shows the hexagons, one plain counts line and one next step, and tucks the voice guide away', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(tiles()).toHaveLength(5);
    expect(screen.getByTestId('risk-profile')).toHaveTextContent('3 need fixing');
    expect(screen.getByTestId('risk-profile').textContent).not.toMatch(/%| of /);
    expect(screen.getByTestId('next-step')).toHaveTextContent('1 of 3');
    expect(screen.getByTestId('voice-details')).not.toHaveAttribute('open');
    expect(screen.queryByTestId('risk-score-card')).toBeNull();
    expect(screen.queryByTestId('confirmation-progress')).toBeNull();
  });

  it('the first next step is the first red tile, with its draft fix step', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const card = screen.getByTestId('next-step');
    expect(card).toHaveTextContent('WebRTC Leak');
    expect(card).toHaveTextContent('Turn off WebRTC address sharing');
    expect(screen.getByTestId('fix-draft-note')).toBeInTheDocument();
  });

  it('"I\'ve done this" makes the tile medium green "You told us", never solid, and counts as you told us, not clear', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(within(screen.getByTestId('next-step')).getByText("I've done this"));
    const webrtc = tiles().find((b) => /WebRTC Leak/.test(b.getAttribute('aria-label') ?? ''))!;
    expect(webrtc.getAttribute('data-tile-kind')).toBe('you_told_us');
    expect(webrtc.getAttribute('aria-label')).toMatch(/You told us/);
    const profile = screen.getByTestId('risk-profile');
    expect(profile).toHaveTextContent('1 you told us');
    expect(profile).toHaveTextContent('0 clear');
    expect(profile).toHaveTextContent('2 need fixing');
    // the next step moves on to the next red tile
    expect(screen.getByTestId('next-step')).toHaveTextContent('Canvas Fingerprint');
  });

  it('"Later" moves on and is not a "no": nothing changes on the tile, and the skipped step can be brought back', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(within(screen.getByTestId('next-step')).getByText('Later'));
    expect(screen.getByTestId('next-step')).toHaveTextContent('Canvas Fingerprint');
    const webrtc = tiles().find((b) => /WebRTC Leak/.test(b.getAttribute('aria-label') ?? ''))!;
    expect(webrtc.getAttribute('data-tile-kind')).toBe('needs_fixing');
    fireEvent.click(within(screen.getByTestId('next-step')).getByText('Later'));
    expect(screen.getByTestId('next-step')).toHaveTextContent('WebGL Signature');
    fireEvent.click(within(screen.getByTestId('next-step')).getByText('Later'));
    expect(screen.queryByTestId('next-step')).toBeNull();
    fireEvent.click(screen.getByTestId('show-skipped'));
    expect(screen.getByTestId('next-step')).toHaveTextContent('WebRTC Leak');
  });

  it('taps unlock nothing: more hexagons come only from the Show more button', () => {
    vi.useFakeTimers();
    render(<HexagonGrid hexagons={makeHexagons()} />);
    for (const b of tiles()) fireEvent.click(b);
    act(() => { vi.advanceTimersByTime(12000); });
    expect(tiles()).toHaveLength(5);
    expect(screen.queryByTestId('panel-language')).toBeNull();
    fireEvent.click(screen.getByTestId('show-more'));
    act(() => { vi.advanceTimersByTime(12000); });
    expect(tiles()).toHaveLength(8);
    // the funnel event still goes out (as on main) with the tile kind: a tap is "seen", it unlocked nothing
    expect(analytics.trackHexagonConfirm).toHaveBeenCalledWith('webrtc-leak', 'WebRTC Leak', true, 'needs_fixing');
  });

  it('the extras are out of the way: no stranger card, no panels, no final summary, no confetti', async () => {
    vi.useFakeTimers();
    const confetti = (await import('canvas-confetti')).default as unknown as ReturnType<typeof vi.fn>;
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(screen.getByTestId('show-more'));
    act(() => { vi.advanceTimersByTime(12000); });
    for (let i = 0; i < 3; i++) for (const b of tiles()) fireEvent.click(b);
    act(() => { vi.advanceTimersByTime(12000); });
    expect(screen.queryByTestId('stranger-guess-card')).toBeNull();
    expect(screen.queryByTestId('panel-language')).toBeNull();
    expect(screen.queryByTestId('final-summary')).toBeNull();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('the detail ladder starts at the counts and goes deeper only when asked; no level shows a percentage', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(screen.queryByTestId('detail-level-2')).toBeNull();
    fireEvent.click(screen.getByText('Reasons'));
    expect(screen.getByTestId('detail-level-2')).toHaveTextContent('A tracker can read this and it matters.');
    expect(screen.getByTestId('detail-level-2')).toHaveTextContent('We have not looked at this yet.');
    expect(screen.queryByTestId('pro-detail')).toBeNull();
    fireEvent.click(screen.getByText('Pro mode'));
    const pro = screen.getAllByTestId('pro-detail').map((n) => n.textContent ?? '');
    expect(pro.some((t) => /Read from your browser/.test(t))).toBe(true);
    // a tile that makes no claim never says it was read
    expect(pro.filter((t) => /No reading used/.test(t))).toHaveLength(1);
    expect(pro.filter((t) => /Read from your browser/.test(t) && /No reading used/.test(t))).toHaveLength(0);
    fireEvent.click(screen.getByText('Expert mode'));
    expect(screen.getAllByTestId('expert-detail')).not.toHaveLength(0);
    expect(screen.getByTestId('detail-ladder').textContent).not.toMatch(/\d+%/);
  });

  it('the help page opens and is marked as draft; it never promises points for tapping', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(screen.getByTestId('help-open'));
    const dialog = screen.getByTestId('help-dialog');
    expect(dialog).toHaveTextContent('Draft help text');
    expect(dialog).toHaveTextContent('Do I get points for tapping hexagons?');
    expect(dialog.textContent).not.toMatch(/\d+%/);
  });
});

describe('HexagonGrid with only the tile flag on (Phase 1 look stays as it was)', () => {
  beforeEach(() => { vi.stubEnv('VITE_HEX_TILE_V2', 'true'); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => vi.unstubAllEnvs());
  it('has no next step, no ladder and no Show more button', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(screen.queryByTestId('next-step')).toBeNull();
    expect(screen.queryByTestId('detail-ladder')).toBeNull();
    expect(screen.queryByTestId('show-more')).toBeNull();
    expect(screen.getByTestId('risk-profile')).toBeInTheDocument();
  });
});
