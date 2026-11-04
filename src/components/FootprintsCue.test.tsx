import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FootprintsCue, { FOOTPRINTS_PROMISE, FOOTPRINTS_SCOPE, FOOTPRINTS_EMPTY } from './FootprintsCue';

describe('FootprintsCue', () => {
  it('always shows the promise and its scope, even with no footprints', () => {
    render(<FootprintsCue footprints={[]} onRemove={vi.fn()} />);
    expect(screen.getByTestId('footprints-promise')).toHaveTextContent(FOOTPRINTS_PROMISE);
    expect(screen.getByTestId('footprints-scope')).toHaveTextContent(FOOTPRINTS_SCOPE);
    expect(screen.getByTestId('footprints-empty')).toHaveTextContent(FOOTPRINTS_EMPTY);
    expect(screen.queryByTestId('footprints-trail')).toBeNull();
  });

  it('keeps the promise inside what option A allows: the path and a saved scan, with server logs stated as separate', () => {
    expect(FOOTPRINTS_PROMISE).toMatch(/Remove a step and its footprint goes\./);
    expect(FOOTPRINTS_PROMISE).toMatch(/Close this session and your path is gone\./);
    expect(FOOTPRINTS_SCOPE).toMatch(/your path and any scan you saved/);
    expect(FOOTPRINTS_SCOPE).toMatch(/Anonymous server logs are separate/);
    for (const text of [FOOTPRINTS_PROMISE, FOOTPRINTS_SCOPE, FOOTPRINTS_EMPTY]) {
      expect(text).not.toMatch(/nothing is left|we keep nothing|you leave no footprints/i);
    }
  });

  it('lists each footprint in order with a labelled remove button', () => {
    const onRemove = vi.fn();
    render(<FootprintsCue footprints={[{ id: 'a', label: 'Browser' }, { id: 'b', label: 'Location' }]} onRemove={onRemove} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Browser', 'Location']);
    expect(screen.queryByTestId('footprints-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove footprint: Location' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('b');
  });
});
