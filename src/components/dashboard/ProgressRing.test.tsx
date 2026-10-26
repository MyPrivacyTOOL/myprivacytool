import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

describe('ProgressRing (CK-8322)', () => {
  it('shows a count and "checked", never a percentage or "Secured"', () => {
    const { container } = render(<ProgressRing securedCount={29} totalCount={54} />);
    expect(container.textContent).toBe('29checked');
    expect(container.textContent).not.toMatch(/%|secured/i);
    const ring = screen.getByRole('progressbar', { name: 'Checked' });
    expect(ring).toHaveAttribute('aria-valuenow', '29');
    expect(ring).toHaveAttribute('aria-valuetext', '29 tiles checked');
  });
  it('says "1 tile", and keeps the count inside 0 to the total', () => {
    render(<ProgressRing securedCount={1} totalCount={54} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 tile checked');
    render(<ProgressRing securedCount={99} totalCount={54} />);
    expect(screen.getAllByRole('progressbar')[1]).toHaveAttribute('aria-valuenow', '54');
  });
});
