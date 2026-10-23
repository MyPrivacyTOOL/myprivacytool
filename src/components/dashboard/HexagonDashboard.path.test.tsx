import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HexagonDashboard } from './HexagonDashboard';
import { pathMark } from '@/lib/footprintsPath';
import type { Hexagon, ScanResult } from '@/types/hexagon';

const hex = (o: Partial<Hexagon> = {}): Hexagon => ({
  id: 'h1', pillar: 'security', label: 'Spam lists', status: 'guess', data: 'Found on 2 HK spam lists', source: 's',
  confidence_score: 0.6, exposure: false, remediation: '', ...o,
});
const data: ScanResult = { hexagons: [hex(), hex({ id: 'h2', label: 'Phone' }), hex({ id: 'h3', label: 'Email' })] };

afterEach(() => vi.unstubAllEnvs());

describe('pathMark', () => {
  it('shows nothing until the first step', () => {
    expect(pathMark(undefined, 'a')).toBeUndefined();
    expect(pathMark({ steps: [], nextId: 'a' }, 'a')).toBeUndefined();
  });
  it('numbers the steps, puts you on the last, dashes the next and fades the rest', () => {
    const p = { steps: ['a', 'b'], nextId: 'c' };
    expect(pathMark(p, 'a')).toEqual({ state: 'on', step: 1 });
    expect(pathMark(p, 'b')).toEqual({ state: 'here', step: 2 });
    expect(pathMark(p, 'c')).toEqual({ state: 'next' });
    expect(pathMark(p, 'z')).toEqual({ state: 'faint' });
  });
});

describe('footprints path on the dashboard', () => {
  it('is off by default: no path marks at all', () => {
    render(<HexagonDashboard initialData={data} />);
    fireEvent.click(screen.getAllByTitle(/tap to confirm/i)[0]);
    fireEvent.click(screen.getByRole('button', { name: /yes, that's me/i }));
    expect(document.querySelector('[data-path]')).toBeNull();
  });

  it('when on: first answer lights that hexagon with the footprints, dashes the next guess, fades the rest', () => {
    vi.stubEnv('VITE_FOOTPRINTS_CUE', 'true');
    render(<HexagonDashboard initialData={data} />);
    expect(document.querySelector('[data-path]')).toBeNull(); // nothing fades before the first step
    fireEvent.click(screen.getAllByTitle(/tap to confirm/i)[0]);
    fireEvent.click(screen.getByRole('button', { name: /yes, that's me/i }));
    expect(document.querySelector('[data-path="here"]')).not.toBeNull();
    expect(screen.getByTestId('path-here')).toBeInTheDocument();
    expect(screen.getByTestId('path-step-1')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-path="next"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-path="faint"]')).toHaveLength(1);
  });

  it('a second answer moves the footprints on and the first stays lit', () => {
    vi.stubEnv('VITE_FOOTPRINTS_CUE', 'true');
    render(<HexagonDashboard initialData={data} />);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getAllByTitle(/tap to confirm/i)[0]);
      fireEvent.click(screen.getByRole('button', { name: /no, not me/i }));
    }
    expect(document.querySelectorAll('[data-path="on"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-path="here"]')).toHaveLength(1);
    expect(screen.getAllByTestId('path-here')).toHaveLength(1);
  });
});
