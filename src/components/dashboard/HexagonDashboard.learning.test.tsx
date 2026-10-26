import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HexagonDashboard } from './HexagonDashboard';
import type { Hexagon } from '@/types/hexagon';

const shown = vi.fn();
const answer = vi.fn();
vi.mock('@/lib/learning/events', () => ({
  recordShown: (...a: unknown[]) => shown(...a),
  recordAnswer: (...a: unknown[]) => answer(...a),
}));

const hex = (o: Partial<Hexagon> = {}): Hexagon => ({
  id: 'location', pillar: 'Device & Network', label: 'Location', status: 'guess', data: 'London', source: 'web-scan',
  confidence_score: 0.95, remediation: null, exposure: true, tile: 'our_guess', ...o,
});

beforeEach(() => { shown.mockClear(); answer.mockClear(); });

describe('HexagonDashboard learning events (MPC-7915)', () => {
  it('reports the tiles that offer an answer as shown, with the look and confidence but no value', () => {
    render(<HexagonDashboard initialData={{ hexagons: [hex(), hex({ id: 'isp', label: 'ISP', status: 'not_checked', tile: 'not_checked', data: null })] }} />);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith({ hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95, source: 'web-scan' });
    expect(JSON.stringify(shown.mock.calls)).not.toMatch(/London/);
  });
  it('reports Yes as yes_me and No as not_me, and only after the button, never for a plain tap', () => {
    const { unmount } = render(<HexagonDashboard initialData={{ hexagons: [hex()] }} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    expect(answer).not.toHaveBeenCalled();                       // opening the question is not an answer
    fireEvent.click(screen.getByRole('button', { name: /yes, that's me/i }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ hexagonId: 'location' }), 'yes_me');
    unmount(); answer.mockClear();
    render(<HexagonDashboard initialData={{ hexagons: [hex()] }} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /no, not me/i }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ hexagonId: 'location' }), 'not_me');
  });
  it('reports "This isn\'t right" as disputed and the labelled "Keep it" as kept, but closing the prompt reports nothing', () => {
    const confident = hex({ id: 'cookies-status', status: 'checked', exposure: false, tile: 'seen_low_risk', confidence_score: 0.95 });
    const { unmount } = render(<HexagonDashboard initialData={{ hexagons: [confident] }} />);
    fireEvent.click(screen.getByTitle(/cookies-status|Location|Checked|Seen/i));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/Seen/i));
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ hexagonId: 'cookies-status', tileKind: 'seen_low_risk' }), 'kept');
    unmount(); answer.mockClear();
    render(<HexagonDashboard initialData={{ hexagons: [confident] }} />);
    fireEvent.click(screen.getByTitle(/Seen/i));
    fireEvent.click(screen.getByRole('button', { name: /this isn't right/i }));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ hexagonId: 'cookies-status' }), 'disputed');
  });
  it('sends nothing for a hexagon that does not come from the web scan', () => {
    render(<HexagonDashboard initialData={{ hexagons: [hex({ source: 'xposedornot', tile: undefined })] }} />);
    expect(shown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /yes, that's me/i }));
    expect(answer).not.toHaveBeenCalled();
  });
});
