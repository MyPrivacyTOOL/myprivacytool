import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BreachConfirmationPanel from './BreachConfirmationPanel';
import { breachFindingsFromLookup } from '@/lib/breachFindings';

const findings = breachFindingsFromLookup(
  { status: 'checked', confidence: 'medium', pastes: [], pasteCount: 0, breaches: [{ name: 'Canva', date: '', dataClasses: [] }, { name: 'Zynga', date: '', dataClasses: [] }] },
  'xposedornot',
);

describe('BreachConfirmationPanel', () => {
  it('counts only confirmed exposures and sends a signal without the finding data', () => {
    const onSignal = vi.fn();
    render(<BreachConfirmationPanel findings={findings} onLearningSignal={onSignal} />);
    expect(screen.getByTestId('breach-count')).toHaveTextContent('0 exposures counted');
    fireEvent.click(screen.getByRole('button', { name: /canva/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(screen.getByTestId('breach-count')).toHaveTextContent('1 exposure counted');
    fireEvent.click(screen.getByRole('button', { name: /zynga/i }));
    fireEvent.click(screen.getByRole('button', { name: /no, not me/i }));
    expect(screen.getByTestId('breach-count')).toHaveTextContent('1 exposure counted');
    expect(screen.getByText('All answered.')).toBeInTheDocument();
    expect(onSignal.mock.calls.map(([s]) => s.outcome)).toEqual(['confirmed', 'rejected']);
    expect(JSON.stringify(onSignal.mock.calls)).not.toContain('Canva (');
  });
  it('renders nothing without findings', () => {
    const { container } = render(<BreachConfirmationPanel findings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
