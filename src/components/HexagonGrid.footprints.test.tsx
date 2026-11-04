import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import HexagonGrid from './HexagonGrid';
import { rememberCompletedScan, pendingScan } from '@/lib/webScan';
import { trackHexagonConfirm } from '@/lib/analytics';
import type { HexagonData } from '@/lib/deviceDetection';

// Heavy children and side-effecting libs are irrelevant to the footprints trail.
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
    risk: 'risk',
    confirmed: false,
    category: 'device' as const,
  }));

const hexButtons = () => screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.includes('Confidence'));
const counter = () => screen.getByTestId('confirmation-counter');

beforeEach(() => { sessionStorage.clear(); vi.mocked(trackHexagonConfirm).mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); window.history.replaceState({}, '', '/'); });

describe('the footprints cue is off by default', () => {
  it('shows nothing and changes nothing when the switch is off', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(hexButtons()[0]);
    expect(screen.queryByTestId('footprints-cue')).toBeNull();
    expect(counter()).toHaveTextContent('1/5');
  });
});

describe('the footprints cue (the Path)', () => {
  beforeEach(() => { window.history.replaceState({}, '', '/?footprints=1'); });

  it('shows the promise from the start, then a footprint for every hexagon you step on, oldest first', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    expect(screen.getByTestId('footprints-promise')).toBeInTheDocument();
    expect(screen.getByTestId('footprints-empty')).toBeInTheDocument();

    const buttons = hexButtons();
    fireEvent.click(buttons[2]);
    fireEvent.click(buttons[0]);
    const items = within(screen.getByTestId('footprints-trail')).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Label 2', 'Label 0']);
    expect(screen.queryByTestId('footprints-empty')).toBeNull();
  });

  it('removing a footprint forgets the step: progress goes down and the hexagon can be stepped on again', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    const buttons = hexButtons();
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(counter()).toHaveTextContent('2/5');

    fireEvent.click(screen.getByRole('button', { name: 'Remove footprint: Label 0' }));
    expect(counter()).toHaveTextContent('1/5');
    expect(screen.queryByTestId('footprint-hex-0')).toBeNull();
    expect(screen.getByTestId('footprint-hex-1')).toBeInTheDocument();
    expect(hexButtons()[0].getAttribute('aria-label')).toMatch(/Tap to confirm/);

    fireEvent.click(hexButtons()[0]); // take the step again
    expect(counter()).toHaveTextContent('2/5');
    expect(screen.getByTestId('footprint-hex-0')).toBeInTheDocument();
  });

  it('removing the last footprint brings back the empty state and never goes below zero', () => {
    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(hexButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove footprint: Label 0' }));
    expect(counter()).toHaveTextContent('0/5');
    expect(screen.getByTestId('footprints-empty')).toBeInTheDocument();
  });

  it('takes the removed hexagon out of the scan held for saving, and sends the same count-only event as an unconfirm', () => {
    vi.stubEnv('VITE_SAVE_WEB_SCANS', 'true');
    rememberCompletedScan(makeHexagons());
    expect(pendingScan()).toHaveLength(8);

    render(<HexagonGrid hexagons={makeHexagons()} />);
    fireEvent.click(hexButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove footprint: Label 0' }));

    expect((pendingScan() ?? []).map((h) => h.id)).not.toContain('hex-0');
    expect(pendingScan()).toHaveLength(7);
    expect(trackHexagonConfirm).toHaveBeenLastCalledWith('hex-0', 'Label 0', false, undefined);
  });
});
