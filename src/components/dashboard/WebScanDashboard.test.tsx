import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebScanDashboard } from './WebScanDashboard';
import { HEXAGON_GROUPS } from '../../../shared/hexagon-registry/registry.js';

const { trackScanCompleted, trackScanStarted } = vi.hoisted(() => ({ trackScanCompleted: vi.fn(), trackScanStarted: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackScanCompleted, trackScanStarted }));

describe('WebScanDashboard', () => {
  it('renders one section per registry group for a scan, with the ring at zero before anything is found', () => {
    render(<WebScanDashboard scanned={[]} title="Your scan" />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(HEXAGON_GROUPS);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
  it('sends the canonical privacy_scan_completed once, with all 54 hexagons, when no guess is left; scan_started waits for an answer', () => {
    trackScanCompleted.mockClear();
    render(<WebScanDashboard scanned={[]} />);
    expect(trackScanCompleted).toHaveBeenCalledTimes(1);
    expect(trackScanCompleted).toHaveBeenCalledWith(54);
    expect(trackScanStarted).not.toHaveBeenCalled();
  });
});
