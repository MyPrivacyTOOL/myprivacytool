import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HexagonGrid from './HexagonGrid';
import type { HexagonData } from '@/lib/deviceDetection';
import * as analytics from '@/lib/analytics';

vi.mock('./VoiceAI', () => ({ default: () => null }));
vi.mock('./RiskScore', () => ({ default: () => <div data-testid="risk-score-card">54%</div> }));
vi.mock('./LanguageIntelligencePanel', () => ({ default: () => null }));
vi.mock('./FingerprintPanel', () => ({ default: () => null }));
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
// The first five by the interest order (webrtc, canvas, dns, typing, webgl), then three more.
const makeHexagons = (): HexagonData[] => [
  h('webrtc-leak', 'WebRTC Leak', 'No Leak Detected'),
  h('canvas-fingerprint', 'Canvas Fingerprint', 'Vale Tulip'),
  h('dns-leak', 'DNS Leak', 'No Leak Detected'),
  h('typing-patterns', 'Typing Patterns', 'No input yet', 5),
  h('webgl-fingerprint', 'WebGL Signature', 'Apple graphics'),
  h('location', 'Location', 'Springfield, England', 95),
  h('primary-language', 'Primary Language', 'English (UK)'),
  h('cookies-status', 'Cookies', 'Empty', 100),
];

describe('HexagonGrid with the honest tiles on (MPC-7916)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_HEX_TILE_V2', 'true');
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });
  // More hexagons are revealed on a timer after the fifth tap (as before).
  const tapFiveAndWaitForReveal = () => {
    vi.useFakeTimers();
    for (const b of screen.getAllByRole('button').slice(0, 5)) fireEvent.click(b);
    act(() => { vi.advanceTimersByTime(12000); });
  };

  it('shows the risk profile as plain counts and removes the percentage bar and the score card', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const profile = screen.getByTestId('risk-profile');
    // visible first five: webrtc (couldn't check), canvas (needs fixing), dns (can't check), typing (not checked), webgl (needs fixing)
    expect(profile).toHaveTextContent('0 clear');
    expect(profile).toHaveTextContent('2 need fixing');
    expect(profile).toHaveTextContent('0 our guess');
    expect(profile).toHaveTextContent('3 not checked yet');
    expect(profile.textContent).not.toMatch(/%| of /);
    expect(screen.queryByTestId('confirmation-progress')).toBeNull();
    expect(screen.queryByTestId('risk-score-card')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('no tile on the page shows a percentage or a confirmation prompt', () => {
    const { container } = render(<HexagonGrid hexagons={makeHexagons()} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent).not.toMatch(/%/);
      expect(b.getAttribute('aria-label')).not.toMatch(/%|Confidence|Tap to confirm|Confirmed/);
    }
    expect(container.textContent).not.toMatch(/We found \d+ data points/);
  });

  it('a tap means seen: the reveal works as before, nothing is sent as a confirmation, and nothing is drawn as confirmed', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    tapFiveAndWaitForReveal();
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(analytics.trackHexagonConfirm).not.toHaveBeenCalled();
    expect(analytics.trackHexagonAccuracy).not.toHaveBeenCalled();
    expect(document.querySelector('.animate-hexagon-confirm')).toBeNull();
  });

  it('the counts update as more hexagons are revealed, and a guess appears as our guess', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    tapFiveAndWaitForReveal();
    const profile = screen.getByTestId('risk-profile');
    expect(profile).toHaveTextContent('1 clear');
    expect(profile).toHaveTextContent('1 our guess');
    expect(profile).toHaveTextContent('1 seen, low risk');
  });

  it('no confetti and no final summary, even when every hexagon has been tapped', async () => {
    const confetti = (await import('canvas-confetti')).default as unknown as ReturnType<typeof vi.fn>;
    render(<HexagonGrid hexagons={makeHexagons()} />);
    tapFiveAndWaitForReveal();
    for (const b of screen.getAllByRole('button')) fireEvent.click(b);
    act(() => { vi.advanceTimersByTime(12000); });
    expect(confetti).not.toHaveBeenCalled();
    expect(screen.queryByTestId('final-summary')).toBeNull();
  });
});

describe('HexagonGrid with the flag off (MPC-7916)', () => {
  it('is unchanged: percentage bar, score card and percentages on tiles', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(screen.getByTestId('confirmation-progress')).toBeInTheDocument();
    expect(screen.getByTestId('risk-score-card')).toBeInTheDocument();
    expect(screen.queryByTestId('risk-profile')).toBeNull();
    expect(screen.getAllByRole('button')[0].textContent).toMatch(/99%/);
  });
});
