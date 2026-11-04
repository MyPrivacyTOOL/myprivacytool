// MPC-7471-F1 follow-up: scan-complete dialog in honest-tiles mode (hex_v2). Synthetic tiles; fetch is stubbed and must never be called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import confetti from 'canvas-confetti';
import TilesCompleteDialog from './TilesCompleteDialog';
import { toTile, type HexagonTile } from '@/lib/hexagonTile';
import type { HexagonData } from '@/lib/deviceDetection';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const hex = (over: Partial<HexagonData>): HexagonData => ({
  id: 'device', label: 'Device Type', value: 'Desktop (Windows 11)', icon: '💻', confidence: 92, risk: 'r', confirmed: true, category: 'device', ...over,
});
const hexagons: HexagonData[] = [
  hex({}),
  hex({ id: 'browser', label: 'Browser', value: 'Chrome 141', confidence: 90 }),
  hex({ id: 'google-services', label: 'Google Services', value: 'Signed in', confidence: 100, category: 'social' }),
  hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', confidence: 100, category: 'security' }),
];
const tiles = (): Map<string, HexagonTile> => new Map(hexagons.map((h) => [h.id, toTile(h)]));

const fetchStub = vi.fn();
beforeEach(() => {
  vi.mocked(confetti).mockClear();
  fetchStub.mockReset();
  vi.stubGlobal('fetch', fetchStub);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('scan-complete dialog with the honest tiles (counts only)', () => {
  it('opens once as one labelled dialog with the congratulations and a counts-only risk profile', () => {
    render(<TilesCompleteDialog tiles={tiles()} />);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName('You finished your scan');
    const result = within(dialogs[0]).getByTestId('scan-complete-result');
    expect(result).toHaveTextContent('Your risk profile');
    expect(result).toHaveTextContent(/\d+ clear/);
    expect(result).toHaveTextContent(/\d+ need(s)? fixing/);
    expect(result).toHaveTextContent(/\d+ not checked yet/);
  });

  it('shows no score, percentage, ratio, band label or score link anywhere in the dialog', () => {
    render(<TilesCompleteDialog tiles={tiles()} />);
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toMatch(/\/100|exposure score|coverage|\bHigh\b|\bMedium\b|\bLow\b/);
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toMatch(/\d+ of \d+/);
    expect(screen.queryByTestId('score-method-link')).toBeNull();
    expect(screen.queryByTestId('scan-counts-line')).toBeNull();
  });

  it('does not fire confetti (finishing the taps is not a result)', () => {
    render(<TilesCompleteDialog tiles={tiles()} />);
    expect(confetti).not.toHaveBeenCalled();
  });

  it('never dismisses itself: still one dialog after 60 s', () => {
    vi.useFakeTimers();
    render(<TilesCompleteDialog tiles={tiles()} />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('keeps the consent controls and the form: unticked boxes, same labels, No thanks, unsubscribe line', () => {
    render(<TilesCompleteDialog tiles={tiles()} />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no thanks/i })).toBeInTheDocument();
    expect(screen.getByText(/Unsubscribe in one click/)).toBeInTheDocument();
  });

  it('closes from No thanks and Escape and does not reopen on rerender or timers; nothing is sent', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TilesCompleteDialog tiles={tiles()} />);
    await user.click(screen.getByRole('button', { name: /no thanks/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useFakeTimers();
    rerender(<TilesCompleteDialog tiles={tiles()} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('Escape closes it', async () => {
    const user = userEvent.setup();
    render(<TilesCompleteDialog tiles={tiles()} />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
