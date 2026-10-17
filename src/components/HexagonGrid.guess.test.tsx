import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HexagonGrid from './HexagonGrid';
import type { HexagonData, DeviceData } from '@/lib/deviceDetection';

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
vi.mock('@/lib/behaviorDetection', () => ({ startBehaviorTracking: vi.fn(), stopBehaviorTracking: vi.fn(), getAllBehaviorData: vi.fn(() => ({})) }));
vi.mock('@/lib/analytics', () => ({
  trackHexagonConfirm: vi.fn(), trackDeepScanUnlocked: vi.fn(), trackFunnelStep: vi.fn(), trackHexagonAccuracy: vi.fn(),
  trackTimeToFirstConfirmation: vi.fn(), trackActivity: vi.fn(), trackScanStarted: vi.fn(), trackScanCompleted: vi.fn(),
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const h = (id: string, label: string, value: string, confidence = 99): HexagonData => ({ id, label, value, icon: '•', confidence, risk: 'risk', confirmed: false, category: 'device' });
const hexes = (): HexagonData[] => [
  h('location', 'Location', 'London, England', 95),
  h('browser', 'Browser', 'Chrome 141'),
  h('device', 'Device Type', 'Desktop'),
  h('time', 'Time Pattern', 'Sun, 02:14 PM'),
  h('screen', 'Screen Resolution', '1920x1080'),
];
const deviceData = { location: { city: 'London', region: 'England', country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278 } } as unknown as DeviceData;

describe('HexagonGrid guess check (prototype, honest tiles on)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_HEX_TILE_V2', 'true');
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const location = () => screen.getByLabelText(/^Location:/);

  it('selecting the Location guess asks "Are you in London, England?"; other tiles ask nothing', () => {
    render(<HexagonGrid hexagons={hexes()} deviceData={deviceData} />);
    fireEvent.click(screen.getByLabelText(/^Browser:/));
    expect(screen.queryByTestId('guess-check')).toBeNull();
    fireEvent.click(location());
    expect(screen.getByRole('heading', { name: 'Are you in London, England?' })).toBeInTheDocument();
  });

  it('Yes makes the tile "You said yes" and counts it as confirmed, as the visitor\'s word', () => {
    render(<HexagonGrid hexagons={hexes()} deviceData={deviceData} />);
    fireEvent.click(location());
    fireEvent.click(screen.getByTestId('guess-yes'));
    expect(location().getAttribute('aria-label')).toMatch(/You said yes/);
    expect(screen.getByTestId('risk-profile')).toHaveTextContent('1 confirmed');
    expect(screen.getByTestId('guess-answer')).toHaveTextContent('your word, not our proof');
  });

  it('No makes the tile "Our guess was wrong" and stops showing the wrong place', () => {
    render(<HexagonGrid hexagons={hexes()} deviceData={deviceData} />);
    fireEvent.click(location());
    fireEvent.click(screen.getByTestId('guess-no'));
    expect(location().getAttribute('aria-label')).toMatch(/Our guess was wrong/);
    expect(location().getAttribute('aria-label')).not.toMatch(/London/);
  });

  it('the device check turns the guess into "Your device agrees" and sends nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (s: PositionCallback) => s({ coords: { latitude: 51.52, longitude: -0.1 } } as GeolocationPosition) } });
    render(<HexagonGrid hexagons={hexes()} deviceData={deviceData} />);
    fireEvent.click(location());
    fireEvent.click(screen.getByTestId('guess-device'));
    await waitFor(() => expect(location().getAttribute('aria-label')).toMatch(/Your device agrees/));
    expect(f).not.toHaveBeenCalled();
  });

  it('with the flag off nothing is asked', () => {
    vi.unstubAllEnvs();
    render(<HexagonGrid hexagons={hexes()} deviceData={deviceData} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.queryByTestId('guess-check')).toBeNull();
  });
});
