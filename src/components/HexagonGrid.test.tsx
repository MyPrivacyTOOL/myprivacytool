import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Fresh objects every call, all confirmed:false: what Index.tsx does on each
// orientation/motion update.
const makeHexagons = (): HexagonData[] =>
  Array.from({ length: 8 }, (_, i) => ({
    id: `hex-${i}`,
    label: `Label ${i}`,
    value: `Value ${i}`,
    icon: '•',
    confidence: 80,
    risk: 'risk',
    confirmed: false,
    category: 'device' as const,
  }));

const hexButtons = () => screen.getAllByRole('button');
const counter = () => screen.getByTestId('confirmation-counter');

describe('HexagonGrid confirmation', () => {
  it('confirmation survives hexagon regeneration', () => {
    const { rerender } = render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(counter()).toHaveTextContent('0/5');

    for (const b of hexButtons().slice(0, 3)) fireEvent.click(b);
    expect(counter()).toHaveTextContent('3/5');

    // Parent regenerates every hexagon with confirmed:false.
    rerender(<HexagonGrid hexagons={makeHexagons()} />);
    rerender(<HexagonGrid hexagons={makeHexagons()} />);

    expect(counter()).toHaveTextContent('3/5');
    const pressed = hexButtons().map(b => b.getAttribute('aria-pressed'));
    expect(pressed.slice(0, 3)).toEqual(['true', 'true', 'true']);
    expect(pressed.slice(3)).not.toContain('true');

    // Not-yet-confirmed hexagons can still be confirmed after regeneration.
    fireEvent.click(hexButtons()[3]);
    expect(counter()).toHaveTextContent('4/5');
  });

  it('counts repeat and rapid clicks on one hexagon once', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const first = hexButtons()[0];
    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(first);
    expect(counter()).toHaveTextContent('1/5');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('confirms with Enter and Space', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.keyDown(hexButtons()[0], { key: 'Enter' });
    fireEvent.keyDown(hexButtons()[1], { key: ' ' });
    expect(counter()).toHaveTextContent('2/5');
  });
});
