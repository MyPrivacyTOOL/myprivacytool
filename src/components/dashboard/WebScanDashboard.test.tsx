import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebScanDashboard } from './WebScanDashboard';
import { HEXAGON_GROUPS } from '../../../shared/hexagon-registry/registry.js';

describe('WebScanDashboard', () => {
  it('renders one section per registry group for a scan, with the ring at zero before anything is found', () => {
    render(<WebScanDashboard scanned={[]} title="Your scan" />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(HEXAGON_GROUPS);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});
