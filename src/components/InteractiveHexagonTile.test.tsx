import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { InteractiveHexagonTile } from './InteractiveHexagonTile';
import { useHexagonState } from '@/hooks/useHexagonState';
import type { Hexagon, ScanResult } from '@/types/hexagon';

const hex = (o: Partial<Hexagon> = {}): Hexagon => ({
  id: 'h1', pillar: 'email', label: 'Leaked email', status: 'guess', data: 'a@b.com', source: 'xposedornot',
  confidence_score: 0.6, remediation: null, ...o,
});

describe('InteractiveHexagonTile', () => {
  it('renders a guess with animate-pulse', () => {
    render(<InteractiveHexagonTile hexagon={hex()} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTitle(/tap to confirm/i)).toHaveClass('animate-pulse');
  });
  it('Yes confirms and No rejects', () => {
    const onConfirm = vi.fn();
    const { unmount } = render(<InteractiveHexagonTile hexagon={hex()} onConfirm={onConfirm} onDispute={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onConfirm).toHaveBeenCalledWith('h1', true);
    unmount();
    const onConfirm2 = vi.fn();
    render(<InteractiveHexagonTile hexagon={hex()} onConfirm={onConfirm2} onDispute={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /no, not me/i }));
    expect(onConfirm2).toHaveBeenCalledWith('h1', false);
  });
  it('closing the prompt with Escape records nothing', () => {
    const onConfirm = vi.fn();
    render(<InteractiveHexagonTile hexagon={hex()} onConfirm={onConfirm} onDispute={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('has no `!` badge: a checked finding above 0.8 opens a labelled dispute prompt, and only its button disputes', () => {
    const onDispute = vi.fn();
    render(<InteractiveHexagonTile hexagon={hex({ status: 'checked', confidence_score: 0.95 })} onConfirm={vi.fn()} onDispute={onDispute} />);
    expect(screen.queryByTitle('Not me?')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByTitle('Checked.'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(onDispute).not.toHaveBeenCalled();          // opening the prompt records nothing
    fireEvent.click(screen.getByRole('button', { name: /this isn't right/i }));
    expect(onDispute).toHaveBeenCalledWith('h1');
  });
  it('Keep it and Escape close the dispute prompt without disputing', () => {
    const onDispute = vi.fn();
    render(<InteractiveHexagonTile hexagon={hex({ status: 'checked', confidence_score: 0.95 })} onConfirm={vi.fn()} onDispute={onDispute} />);
    fireEvent.click(screen.getByTitle('Checked.'));
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    fireEvent.click(screen.getByTitle('Checked.'));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onDispute).not.toHaveBeenCalled();
  });
  it('opens no prompt for a checked finding at 0.8 or below, or one already disputed', () => {
    const onDispute = vi.fn();
    const { rerender } = render(<InteractiveHexagonTile hexagon={hex({ status: 'checked', confidence_score: 0.7 })} onConfirm={vi.fn()} onDispute={onDispute} />);
    fireEvent.click(screen.getByTitle('Checked.'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(<InteractiveHexagonTile hexagon={hex({ status: 'disputed', confidence_score: 0.95 })} onConfirm={vi.fn()} onDispute={onDispute} />);
    fireEvent.click(screen.getByTitle(/you disputed/i));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onDispute).not.toHaveBeenCalled();
  });
});

describe('useHexagonState', () => {
  const initial: ScanResult = { hexagons: [hex(), hex({ id: 'h2', status: 'checked', confidence_score: 0.95 })] };
  it('transitions, drops rejected findings from scoring, and emits one signal per answer', () => {
    const onSignal = vi.fn();
    const { result } = renderHook(() => useHexagonState(initial, onSignal));
    expect(result.current.scoredHexagons.map((h) => h.id)).toEqual(['h2']);
    act(() => { result.current.handleConfirm('h1', false); result.current.handleConfirm('h1', true); });
    expect(result.current.scanResult.hexagons[0].status).toBe('false_positive');
    act(() => result.current.handleDispute('h2'));
    expect(result.current.scanResult.hexagons[1].status).toBe('disputed');
    expect(result.current.scoredHexagons).toHaveLength(0);
    expect(onSignal).toHaveBeenCalledTimes(2);
    expect(onSignal.mock.calls.map(([s]) => s.outcome)).toEqual(['rejected', 'disputed']);
  });
});

describe('InteractiveHexagonTile honest look', () => {
  it('a finding gets its own kind and no all-clear tick; a clear one gets the tick', () => {
    const { unmount } = render(<InteractiveHexagonTile hexagon={hex({ status: 'checked', tile: 'seen_low_risk', confidence_score: 0.5 })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTestId('tile-badge')).toHaveTextContent('i');
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Seen · minor');
    expect(screen.getByTitle('Leaked email: Seen · minor.')).toBeTruthy();
    unmount();
    render(<InteractiveHexagonTile hexagon={hex({ status: 'checked', tile: 'clear', confidence_score: 0.5 })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTestId('tile-badge')).toHaveTextContent('✓');
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Clear');
  });
  it('a tile that needs fixing opens the next step, and once fixed it reads "you told us", not clear', () => {
    const onSelect = vi.fn();
    const h = hex({ status: 'checked', tile: 'needs_fixing', confidence_score: 0.5 });
    const { rerender } = render(<InteractiveHexagonTile hexagon={h} onConfirm={vi.fn()} onDispute={vi.fn()} onSelect={onSelect} />);
    expect(screen.getByTestId('tile-badge')).toHaveTextContent('!');
    fireEvent.click(screen.getByTitle('Leaked email: Needs fixing.'));
    expect(onSelect).toHaveBeenCalledWith(h);
    rerender(<InteractiveHexagonTile hexagon={h} onConfirm={vi.fn()} onDispute={vi.fn()} onSelect={onSelect} fixed />);
    expect(screen.getByTestId('tile-line')).toHaveTextContent('You told us');
  });
  it('a grey no-claim tile does not show the detector value', () => {
    render(<InteractiveHexagonTile hexagon={hex({ status: 'not_checked', data: 'Leaking: 1.2.3.4', tile: 'couldnt_check' })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.queryByText('Leaking: 1.2.3.4')).toBeNull();
    expect(screen.getByTestId('tile-line')).toHaveTextContent("Check didn't finish");
  });
  it('a guess keeps its "Tap to confirm" tooltip, because it is the one tile that asks the visitor to answer', () => {
    render(<InteractiveHexagonTile hexagon={hex({ status: 'guess', tile: 'our_guess' })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTitle(/tap to confirm/i)).toBeTruthy();
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Our guess');
  });
  it('a guess shows how sure we are in words and a darker or paler purple, and never a number', () => {
    const fill = (c: HTMLElement) => (c.querySelector('polygon') as SVGPolygonElement).style.fill;
    const { container, unmount } = render(<InteractiveHexagonTile hexagon={hex({ status: 'guess', tile: 'our_guess', band: 'likely' })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Our guess · likely');
    const likely = fill(container);
    unmount();
    const m = render(<InteractiveHexagonTile hexagon={hex({ status: 'guess', tile: 'our_guess', band: 'maybe' })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Our guess · maybe');
    const maybe = fill(m.container);
    m.unmount();
    const w = render(<InteractiveHexagonTile hexagon={hex({ status: 'guess', tile: 'our_guess', band: 'weak' })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Our guess · weak');
    const weak = fill(w.container);
    expect(new Set([likely, maybe, weak]).size).toBe(3);
    expect(likely).toContain('0.28'); expect(maybe).toContain('0.16'); expect(weak).toContain('0.08');
    expect(screen.getByTestId('tile-line').textContent).not.toMatch(/\d|%/);
  });
  it('a guess with no band keeps the plain faint look and line', () => {
    render(<InteractiveHexagonTile hexagon={hex({ status: 'guess', tile: 'our_guess' })} onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByTestId('tile-line')).toHaveTextContent(/^Our guess$/);
  });
});
