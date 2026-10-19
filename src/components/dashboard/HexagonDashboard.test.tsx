import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HexagonDashboard } from './HexagonDashboard';
import { countSecured } from './countSecured';
import type { Hexagon, ScanResult } from '@/types/hexagon';

const hex = (o: Partial<Hexagon> = {}): Hexagon => ({
  id: 'h1', pillar: 'security', label: 'Spam lists', status: 'guess', data: 'Found on 2 HK spam lists', source: 's',
  confidence_score: 0.6, remediation: 'Register with the HK Do Not Call registry.', remediation_url: 'https://example.org/dnc',
  exposure: true, ...o,
});
const data: ScanResult = {
  hexagons: [hex(), hex({ id: 'h2', pillar: 'contact', label: 'Phone', status: 'checked', exposure: false, confidence_score: 0.95 }), hex({ id: 'h3', pillar: 'weird', status: 'not_checked' })],
};

describe('HexagonDashboard', () => {
  it('groups by pillar, keeping unknown pillars, with the ring showing the count of checked tiles', () => {
    render(<HexagonDashboard initialData={data} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Security', 'Contact & Comms', 'Weird']);
    expect(screen.getByRole('progressbar', { hidden: true })).toHaveAttribute('aria-valuenow', '1'); // one tile checked
  });

  it('guess -> question -> Yes opens the action plan; Mark as Fixed needs the checkbox; then the ring grows', () => {
    render(<HexagonDashboard initialData={data} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /yes, that's me/i }));
    expect(screen.queryByText('Is this you?')).toBeNull();
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('Exposure Confirmed')).toBeInTheDocument();
    expect(within(panel).getByRole('link')).toHaveAttribute('href', 'https://example.org/dnc');
    const fixed = within(panel).getByRole('button', { name: /mark as fixed/i });
    expect(fixed).toBeDisabled();
    expect(screen.getByRole('progressbar', { hidden: true })).toHaveAttribute('aria-valuenow', '1'); // exposure still open
    fireEvent.click(within(panel).getByRole('checkbox'));
    expect(fixed).toBeEnabled();
    fireEvent.click(fixed);
    expect(screen.getByRole('progressbar', { hidden: true })).toHaveAttribute('aria-valuenow', '2'); // two tiles checked or fixed
  });

  it('No closes the question and records a false positive', () => {
    render(<HexagonDashboard initialData={data} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /no, not me/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTitle('You said this is not you.')).toBeInTheDocument();
  });

  it('countSecured ignores unfixed exposures and non-http remediation links render no button', () => {
    expect(countSecured([hex({ status: 'confirmed' })], new Set())).toBe(0);
    expect(countSecured([hex({ status: 'confirmed' })], new Set(['h1']))).toBe(1);
    render(<HexagonDashboard initialData={{ hexagons: [hex({ remediation_url: 'javascript:alert(1)' })] }} />);
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /yes, that's me/i }));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('Export report downloads the honeycomb as one HTML file', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<HexagonDashboard initialData={data} title="Sarah" />);
    fireEvent.click(screen.getByRole('button', { name: /export report/i }));
    expect(click).toHaveBeenCalledOnce();
    expect(await created[0].text()).toContain('<title>Sarah</title>');
    click.mockRestore();
  });

  it('tapping a confident finding asks "Does this look wrong?"; This isn\'t right records it, Keep it records nothing', () => {
    render(<HexagonDashboard initialData={data} />);
    fireEvent.click(screen.getByTitle('Checked.'));
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    expect(screen.queryByTitle(/you disputed/i)).toBeNull();
    fireEvent.click(screen.getByTitle('Checked.'));
    fireEvent.click(screen.getByRole('button', { name: /this isn't right/i }));
    expect(screen.getByTitle(/you disputed/i)).toBeInTheDocument();
  });

  it('onStarted fires once at the first answer; onAllAnswered fires once when no guess is left', () => {
    const onStarted = vi.fn();
    const onAllAnswered = vi.fn();
    render(<HexagonDashboard initialData={data} onStarted={onStarted} onAllAnswered={onAllAnswered} />);
    expect(onStarted).not.toHaveBeenCalled();
    expect(onAllAnswered).not.toHaveBeenCalled(); // a guess is still waiting
    fireEvent.click(screen.getByTitle(/tap to confirm/i));
    fireEvent.click(screen.getByRole('button', { name: /no, not me/i }));
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onAllAnswered).toHaveBeenCalledTimes(1);
    expect(onAllAnswered).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByTitle('Checked.'));
    fireEvent.click(screen.getByRole('button', { name: /this isn't right/i }));
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onAllAnswered).toHaveBeenCalledTimes(1);
  });

  it('with no guess to answer, onAllAnswered fires once on arrival and onStarted does not fire', () => {
    const onStarted = vi.fn();
    const onAllAnswered = vi.fn();
    render(<HexagonDashboard initialData={{ hexagons: [hex({ status: 'checked', exposure: false })] }} onStarted={onStarted} onAllAnswered={onAllAnswered} />);
    expect(onAllAnswered).toHaveBeenCalledTimes(1);
    expect(onStarted).not.toHaveBeenCalled();
  });
});
