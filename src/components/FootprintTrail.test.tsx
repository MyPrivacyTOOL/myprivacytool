import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FootprintTrail, { type TrailTile } from './FootprintTrail';
import PathTrailPreview from './PathTrailPreview';

const tiles = (state: TrailTile['state'], n = 12): TrailTile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, label: `Tile ${i}`, emoji: '•', sensitivity: 'medium' as const, state }));

describe('FootprintTrail', () => {
  it('draws every tile once and names each tile and its state for assistive tech', () => {
    render(<FootprintTrail tiles={tiles('held')} ariaLabel="Example" />);
    expect(screen.getAllByRole('img')).toHaveLength(12);
    expect(screen.getByLabelText('Tile 0: we hold it, medium risk')).toBeTruthy();
  });
  it('draws footprints when we hold data and none on a first visit', () => {
    const { container, rerender } = render(<FootprintTrail tiles={tiles('held')} ariaLabel="Example" />);
    const held = container.querySelectorAll('ellipse').length;
    expect(held).toBeGreaterThan(8);
    rerender(<FootprintTrail tiles={tiles('notyet')} ariaLabel="Example" />);
    expect(container.querySelectorAll('ellipse').length).toBe(0);
  });
  it('removes a deleted tile and its prints completely', () => {
    const t = tiles('held');
    t[7] = { ...t[7], state: 'gone' };
    render(<FootprintTrail tiles={t} ariaLabel="Example" />);
    expect(screen.queryByLabelText(/^Tile 7:/)).toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(11);
  });
  it('says what each no-data state means in words, not only colour', () => {
    const t = tiles('held', 4);
    t[0].state = 'notyet'; t[1].state = 'clear'; t[2].state = 'cant';
    render(<FootprintTrail tiles={t} ariaLabel="Example" />);
    expect(screen.getByLabelText('Tile 0: Not checked yet')).toBeTruthy();
    expect(screen.getByLabelText('Tile 1: Checked, nothing found')).toBeTruthy();
    expect(screen.getByLabelText("Tile 2: Can't check from here")).toBeTruthy();
  });
  it('works with just the two tiles every visitor has', () => {
    render(<FootprintTrail tiles={tiles('held', 2)} ariaLabel="Web and Email" />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});

describe('PathTrailPreview', () => {
  it('says it is a preview with example data and always shows Web and Email', () => {
    render(<PathTrailPreview />);
    expect(screen.getByText(/Example, not your data/)).toBeTruthy();
    expect(screen.getByLabelText('Web: we hold it')).toBeTruthy();
    expect(screen.getByLabelText('Email: Not checked yet')).toBeTruthy();
  });
  it('holds Email once the visitor signs up (example toggle)', () => {
    render(<PathTrailPreview />);
    fireEvent.click(screen.getByLabelText(/Pretend I signed up/));
    expect(screen.getByLabelText('Email: we hold it')).toBeTruthy();
  });
  it('switches between the examples: first visit shows no data, deleting removes a tile', () => {
    render(<PathTrailPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'First visit' }));
    expect(screen.getAllByLabelText(/Not checked yet/).length).toBeGreaterThanOrEqual(12);
    fireEvent.click(screen.getByRole('button', { name: 'Deleting data' }));
    expect(screen.queryByLabelText(/^Connected Devices:/)).toBeNull();
  });
});
