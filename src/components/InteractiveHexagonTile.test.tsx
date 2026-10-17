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
