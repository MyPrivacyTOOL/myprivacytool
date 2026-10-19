import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { IdentityConfirmTile } from './IdentityConfirmTile';
import { useIdentityConfirmation } from '@/hooks/useIdentityConfirmation';
import type { IdentityFinding } from '@/lib/findingConfirmation';

const base: IdentityFinding = {
  id: 'e1', pillar: 'email', label: 'Linked email', status: 'guess', data: 'a@b.c', source: 'p',
  confidence_score: 0.6, remediation: null,
};

describe('IdentityConfirmTile', () => {
  it('a guess pulses and asks "Is this you?"; Yes confirms, No rejects', () => {
    const onConfirm = vi.fn();
    render(<IdentityConfirmTile finding={base} onConfirm={onConfirm} onDispute={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Linked email/ })).toHaveClass('animate-pulse');
    fireEvent.click(screen.getByRole('button', { name: /Linked email/ }));
    expect(screen.getByText('Is this you?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Yes, this is me'));
    expect(onConfirm).toHaveBeenCalledWith('e1', true);
    fireEvent.click(screen.getByRole('button', { name: /Linked email/ }));
    fireEvent.click(screen.getByText('No, not me'));
    expect(onConfirm).toHaveBeenLastCalledWith('e1', false);
  });
  it('has no `!` badge: a checked finding above 0.8 opens a labelled dispute prompt, and only its button disputes', () => {
    const onDispute = vi.fn();
    render(<IdentityConfirmTile finding={{ ...base, status: 'checked', confidence_score: 0.95 }} onConfirm={vi.fn()} onDispute={onDispute} />);
    const tile = () => screen.getByTestId('identity-tile-e1').querySelector('button') as HTMLButtonElement;
    expect(screen.queryByTitle('Not me?')).toBeNull();
    fireEvent.click(tile());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(onDispute).not.toHaveBeenCalled();           // opening the prompt records nothing
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    expect(onDispute).not.toHaveBeenCalled();
    fireEvent.click(tile());
    fireEvent.click(screen.getByRole('button', { name: /this isn't right/i }));
    expect(onDispute).toHaveBeenCalledWith('e1');
  });
  it('opens no prompt for a checked finding at 0.8 or below, or one already disputed', () => {
    const onDispute = vi.fn();
    const { rerender } = render(<IdentityConfirmTile finding={{ ...base, status: 'checked', confidence_score: 0.7 }} onConfirm={vi.fn()} onDispute={onDispute} />);
    fireEvent.click(screen.getByTestId('identity-tile-e1').querySelector('button') as HTMLButtonElement);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(<IdentityConfirmTile finding={{ ...base, status: 'disputed', confidence_score: 0.95 }} onConfirm={vi.fn()} onDispute={onDispute} />);
    fireEvent.click(screen.getByTestId('identity-tile-e1').querySelector('button') as HTMLButtonElement);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onDispute).not.toHaveBeenCalled();
  });
});

describe('useIdentityConfirmation', () => {
  it('applies answers, keeps false_positive out of scoredFindings, emits events', () => {
    const events: unknown[] = [];
    const checked = { ...base, id: 'c1', status: 'checked' as const, confidence_score: 0.95 };
    const { result } = renderHook(() => useIdentityConfirmation([base, checked], e => events.push(e)));
    expect(result.current.scoredFindings.map(x => x.id)).toEqual(['c1']);
    act(() => result.current.handleConfirm('e1', false));
    expect(result.current.findings[0].status).toBe('false_positive');
    expect(result.current.scoredFindings.map(x => x.id)).toEqual(['c1']);
    act(() => result.current.handleDispute('c1'));
    expect(result.current.findings[1].status).toBe('disputed');
    expect(result.current.scoredFindings).toEqual([]);
    act(() => result.current.handleConfirm('e1', true)); // refused: already false_positive
    expect(result.current.findings[0].status).toBe('false_positive');
    expect(events).toHaveLength(2);
  });
});
