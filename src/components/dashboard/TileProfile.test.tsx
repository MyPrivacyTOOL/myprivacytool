import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TileProfile } from './TileProfile';

describe('TileProfile', () => {
  it('shows plain counts and a key, with no percentage, ratio or rating word', () => {
    const { container } = render(<TileProfile kinds={['clear', 'needs_fixing', 'needs_fixing', 'our_guess', 'seen_low_risk', 'not_checked', 'couldnt_check', 'cant_check_here']} />);
    expect(screen.getByTestId('tile-profile-clear')).toHaveTextContent('1 clear');
    expect(screen.getByTestId('tile-profile-needsFixing')).toHaveTextContent('2 need fixing');
    expect(screen.getByTestId('tile-profile-notChecked')).toHaveTextContent('3 not checked yet');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/%|\d+\/\d+|secured|low risk|medium|high risk/i);
    expect(screen.getByLabelText('What the tile looks mean').querySelectorAll('li')).toHaveLength(5);
  });
  it('shows "you told us" only once the visitor has said something', () => {
    const { rerender } = render(<TileProfile kinds={['needs_fixing']} />);
    expect(screen.queryByTestId('tile-profile-youToldUs')).toBeNull();
    rerender(<TileProfile kinds={['you_told_us', 'needs_fixing']} />);
    expect(screen.getByTestId('tile-profile-youToldUs')).toHaveTextContent('1 you told us');
  });
  it('renders nothing when no tile has a look', () => {
    const { container } = render(<TileProfile kinds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
