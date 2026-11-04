import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HexagonGrid from './HexagonGrid';
import type { HexagonData } from '@/lib/deviceDetection';

// Heavy children and side-effecting libs are irrelevant to confirmation state.
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
vi.mock('@/lib/analytics', () => ({
  trackHexagonConfirm: vi.fn(),
  trackDeepScanUnlocked: vi.fn(),
  trackFunnelStep: vi.fn(),
  trackHexagonAccuracy: vi.fn(),
  trackTimeToFirstConfirmation: vi.fn(),
  trackActivity: vi.fn(),
  trackScanStarted: vi.fn(),
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const makeHexagons = (): HexagonData[] =>
  Array.from({ length: 8 }, (_, i) => ({
    id: `hex-${i}`,
    label: `Label ${i}`,
    value: `Value ${i}`,
    icon: '•',
    confidence: 80,
    risk: `Plain reason ${i}`,
    confirmed: false,
    category: 'device' as const,
  }));

const hexButtons = () => screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.includes('Confidence'));

describe('CK-7805 tap to explain (no hover on touch)', () => {
  it('a tap keeps the explanation on screen after the finger lifts, and the next tap replaces it', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const buttons = hexButtons();
    fireEvent.touchStart(buttons[0]);
    fireEvent.click(buttons[0]);
    fireEvent.touchEnd(buttons[0]);
    expect(screen.getByTestId('hexagon-explanation-text')).toHaveTextContent('Plain reason 0');

    fireEvent.touchStart(buttons[1]);
    fireEvent.click(buttons[1]);
    fireEvent.touchEnd(buttons[1]);
    expect(screen.getByTestId('hexagon-explanation-text')).toHaveTextContent('Plain reason 1');
  });

  it('tapping an already confirmed hexagon still shows its explanation', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const buttons = hexButtons();
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[0]);
    expect(screen.getByTestId('hexagon-explanation-text')).toHaveTextContent('Plain reason 0');
  });

  it('keeps one fixed height whether it shows the hint or a long explanation (no grid jump)', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const box = screen.getByTestId('hexagon-explanation');
    const before = box.className;
    expect(before).toMatch(/\bh-\[13\.5rem\]/);
    fireEvent.click(hexButtons()[0]);
    expect(screen.getByTestId('hexagon-explanation').className).toBe(before);
  });

  it('shows a hint before any tap, in a box that is always present', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(screen.getByTestId('hexagon-explanation-hint')).toBeInTheDocument();
    fireEvent.click(hexButtons()[0]);
    expect(screen.queryByTestId('hexagon-explanation-hint')).toBeNull();
    expect(screen.getByTestId('hexagon-explanation')).toBeInTheDocument();
  });
});

describe('CK-7805 stranger-guess card timing', () => {
  afterEach(() => vi.useRealTimers());
  it('appears after 8 confirmations and not before', () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    const deviceData = {
      location: { city: 'Springfield', region: 'Exampleshire', country: 'GB', latitude: 0, longitude: 0 },
      device: { type: 'Mobile', os: 'iOS', browser: 'Safari', browserVersion: '17' },
      language: { languages: ['en'], primaryLanguage: 'en', fallbackLanguages: [], locale: 'en-GB', hasLocationMismatch: false, mismatchDetails: null },
    } as never;
    const many = () => Array.from({ length: 14 }, (_, i) => ({
      id: `hex-${i}`, label: `Label ${i}`, value: `Value ${i}`, icon: '•', confidence: 80, risk: 'r', confirmed: false, category: 'device' as const,
    }));
    render(<HexagonGrid hexagons={many()} deviceData={deviceData} />);
    const clickUnconfirmed = (n: number) => {
      for (let k = 0; k < n; k++) {
        const next = hexButtons().find((b) => b.getAttribute('aria-pressed') === 'false');
        fireEvent.click(next!);
      }
    };
    clickUnconfirmed(5);
    act(() => { vi.advanceTimersByTime(12000); });
    clickUnconfirmed(2);
    expect(screen.queryByTestId('stranger-guess-card')).toBeNull();
    clickUnconfirmed(1);
    expect(screen.getByTestId('stranger-guess-card')).toBeInTheDocument();
    expect(screen.getByText(/You are probably in or near Springfield/)).toBeInTheDocument();
  });
});
