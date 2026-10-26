// MPC-7471-F1: one scan-complete dialog (congratulations + result + email form). Synthetic fixtures only; fetch is stubbed and never called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import confetti from 'canvas-confetti';
import EmailCaptureModal from './EmailCaptureModal';
import FinalSummaryPanel from './FinalSummaryPanel';
import RiskScore from './RiskScore';
import { computePageRisk, getPageRiskLabel } from '@/lib/scanResult';
import type { HexagonData } from '@/lib/deviceDetection';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const hex = (over: Partial<HexagonData>): HexagonData => ({
  id: 'device', label: 'Device Type', value: 'Desktop (Windows 11)', icon: '💻', confidence: 92, risk: 'r', confirmed: true, category: 'device', ...over,
});
const hexagons: HexagonData[] = [
  hex({}),
  hex({ id: 'browser', label: 'Browser', value: 'Chrome 141', confidence: 90 }),
  hex({ id: 'google-services', label: 'Google Services', value: 'Signed in', confidence: 100, category: 'social' }),
  hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', confidence: 100, category: 'security' }),
];

const fetchStub = vi.fn();
const mockReducedMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));

beforeEach(() => {
  vi.mocked(confetti).mockClear();
  fetchStub.mockReset();
  vi.stubGlobal('fetch', fetchStub); // a test that reaches the network fails below
  mockReducedMotion(false);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('scan-complete dialog (EmailCaptureModal)', () => {
  const open = (props: Partial<React.ComponentProps<typeof EmailCaptureModal>> = {}) => {
    const onClose = vi.fn();
    const utils = render(<EmailCaptureModal riskScore={78} confirmedCount={23} categoryScores={{}} onClose={onClose} onSubmit={vi.fn()} {...props} />);
    return { onClose, ...utils };
  };

  it('is one labelled dialog with the congratulations, the result line and the form', () => {
    open();
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName('You finished your scan');
    expect(dialogs[0]).toHaveAccessibleDescription(/does not change any of it/);
    expect(within(dialogs[0]).getByTestId('scan-complete-result')).toHaveTextContent('High exposure — 78/100');
    expect(within(dialogs[0]).getByPlaceholderText('your@email.com')).toBeInTheDocument();
  });

  it('does not claim the scan fixed anything', () => {
    open();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/\bfixed\b|you are safe|protected/i);
  });

  it('never dismisses itself: still open and unchanged after 60 s', () => {
    vi.useFakeTimers();
    open();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByTestId('scan-complete-result')).toHaveTextContent('High exposure — 78/100');
  });

  it('keeps the consent controls: unticked box, same wording, No thanks, unsubscribe line', () => {
    open();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Email me my fix guide and Privacy Check, the monthly newsletter. I can unsubscribe at any time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no thanks/i })).toBeInTheDocument();
    expect(screen.getByText(/Unsubscribe in one click/)).toBeInTheDocument();
  });

  it('fires confetti once on open, not again on rerender', () => {
    const { rerender, onClose } = open();
    expect(confetti).toHaveBeenCalledTimes(1);
    rerender(<EmailCaptureModal riskScore={78} confirmedCount={23} categoryScores={{}} onClose={onClose} onSubmit={vi.fn()} />);
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it('with reduced motion: no confetti, same message', () => {
    mockReducedMotion(true);
    open();
    expect(confetti).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('You finished your scan');
  });

  it('keeps the confetti behind the dialog layer (z-index below the overlay)', () => {
    open();
    expect(vi.mocked(confetti).mock.calls[0][0]).toMatchObject({ zIndex: 40 });
  });

  it('moves focus into the dialog (not the email box), closes on Escape, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    function Host() {
      const [shown, setShown] = useState(false);
      return (<><button onClick={() => setShown(true)}>opener</button>{shown && <EmailCaptureModal riskScore={78} confirmedCount={23} onClose={() => setShown(false)} onSubmit={() => {}} />}</>);
    }
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    expect(screen.getByPlaceholderText('your@email.com')).not.toHaveFocus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'opener' })).toHaveFocus());
  });

  it('keeps keyboard focus inside while open', async () => {
    const user = userEvent.setup();
    render(<><button>behind</button><EmailCaptureModal riskScore={78} confirmedCount={23} onClose={() => {}} onSubmit={() => {}} /></>);
    for (let i = 0; i < 12; i++) { await user.tab(); expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true); }
  });

  it('closes from No thanks and the close control', async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await user.click(screen.getByRole('button', { name: /no thanks/i }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('score and label match the page (shared contract)', () => {
  it('RiskScore on the page and the dialog read the same number and label', () => {
    const risk = computePageRisk({ confirmed: 4, total: 4, hexagons, fingerprint: null });
    const label = getPageRiskLabel(risk.percentage, true);
    const { unmount } = render(<RiskScore confirmed={4} total={4} hexagons={hexagons} fingerprint={null} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(String(risk.percentage))).toBeInTheDocument();
    unmount();
    render(<EmailCaptureModal riskScore={risk.percentage} confirmedCount={4} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.getByTestId('scan-complete-result')).toHaveTextContent(`${label} — ${risk.percentage}/100`);
  });

  it('the summary panel passes the page score to the dialog and shows the same label', () => {
    const risk = computePageRisk({ confirmed: 4, total: 4, hexagons, fingerprint: null });
    render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} />);
    expect(screen.getByTestId('scan-complete-result')).toHaveTextContent(`${getPageRiskLabel(risk.percentage, true)} — ${risk.percentage}/100`);
  });

  it('thresholds are the one shared definition: Low 0-39, Medium 40-69, High 70-100; no score is never Low', () => {
    expect([100, 70, 69, 40, 39, 0].map((n) => getPageRiskLabel(n))).toEqual(['High exposure', 'High exposure', 'Medium exposure', 'Medium exposure', 'Low exposure', 'Low exposure']);
    expect(getPageRiskLabel(null)).toBe('Scanning...');
    expect(getPageRiskLabel(null, true)).toBe('Not enough checked to score');
  });
});

describe('opening on scan completion (FinalSummaryPanel)', () => {
  it('opens at once, exactly one dialog, no 1.5 s timer', () => {
    vi.useFakeTimers();
    render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it('stays closed after the visitor dismisses it, through rerenders and timers', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={4} />);
    await user.click(screen.getByRole('button', { name: /no thanks/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useFakeTimers();
    rerender(<FinalSummaryPanel hexagons={[...hexagons]} confirmedCount={4} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(confetti).toHaveBeenCalledTimes(1);
  });
});
