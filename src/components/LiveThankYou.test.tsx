import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveThankYou from './LiveThankYou';
import type { LiveCell } from '@/lib/liveThankYou';

const cells: LiveCell[] = [
  { id: 'a', label: 'Alpha', status: 'clear' },
  { id: 'b', label: 'Bravo', status: 'found' },
  { id: 'c', label: 'Charlie', status: 'not_checked' },
  { id: 'd', label: 'Delta', status: 'guess' },
];
const mm = (reduce: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
const view = (c: LiveCell[]) => render(<MemoryRouter><LiveThankYou cells={c} /></MemoryRouter>);
const statuses = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('data-status'));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('MPC-8452 LiveThankYou', () => {
  beforeEach(() => vi.useFakeTimers());

  it('shows every hexagon as waiting, with no finding, before its turn', () => {
    mm(false);
    view(cells);
    expect(statuses()).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
    expect(screen.queryByText('Checked and clear')).toBeNull();
    expect(screen.queryByTestId('live-thank-you-summary')).toBeNull();
  });

  it('fills in one by one after the curtain, then shows the summary', () => {
    mm(false);
    view(cells);
    act(() => { vi.advanceTimersByTime(1300 + 150); });
    expect(statuses()).toEqual(['clear', 'waiting', 'waiting', 'waiting']);
    act(() => { vi.advanceTimersByTime(150 * 3); });
    expect(statuses()).toEqual(['clear', 'found', 'not_checked', 'guess']);
    expect(screen.getByTestId('live-thank-you-summary')).toHaveTextContent('1 checked and clear, 1 found, 1 our guess, 1 not checked.');
    expect(screen.getByText('Not checked')).toBeInTheDocument();
  });

  it('shows the finished state at once for reduced motion', () => {
    mm(true);
    view(cells);
    expect(statuses()).toEqual(['clear', 'found', 'not_checked', 'guess']);
    expect(screen.getByTestId('live-thank-you-summary')).toBeInTheDocument();
  });

  it('announces in one polite live region, not once per hexagon', () => {
    mm(false);
    view(cells);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('with no scan in this browser offers the free scan and shows no hexagons', () => {
    mm(false);
    view([]);
    expect(screen.getByTestId('live-thank-you-no-scan')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /run the free scan/i })).toHaveAttribute('href', '/');
  });
});
