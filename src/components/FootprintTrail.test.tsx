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

describe('the journey view', () => {
  const journey = (emailHeld: boolean): TrailTile[] => [
    { id: 'origin', label: 'How You Found Us', state: 'origin', level: 'none', caption: 'an ad' },
    { id: 'web', label: 'Web', state: 'held', level: 'low' },
    { id: 'email', label: 'Email', state: emailHeld ? 'held' : 'notyet', level: 'low' },
    { id: 'a', label: 'First name', state: 'want' },
    { id: 'b', label: 'Username', state: 'want' },
    { id: 'c', label: 'Mobile number', state: 'want' },
  ];
  it('draws solid prints below and dotted outline prints for what we do not know', () => {
    const { container } = render(<FootprintTrail tiles={journey(true)} rows={[1, 2, 3]} ariaLabel="Journey" />);
    const feet = Array.from(container.querySelectorAll('g[transform*="rotate"]'));
    expect(feet.some((g) => g.getAttribute('fill') === 'none' && g.getAttribute('stroke') === '#7c5cc4')).toBe(true);
    expect(feet.some((g) => g.getAttribute('fill') !== 'none')).toBe(true);
  });
  it('says in words that a transparent tile is something we do not know', () => {
    render(<FootprintTrail tiles={journey(true)} rows={[1, 2, 3]} ariaLabel="Journey" />);
    expect(screen.getByLabelText("First name: We don't know this")).toBeTruthy();
    expect(screen.getByLabelText('How You Found Us: Where you came from, an ad')).toBeTruthy();
  });
  it('draws no dotted prints when nothing is unknown', () => {
    const t = journey(true).map((x) => (x.state === 'want' ? { ...x, state: 'held' as const } : x));
    const { container } = render(<FootprintTrail tiles={t} rows={[1, 2, 3]} ariaLabel="Journey" />);
    expect(Array.from(container.querySelectorAll('g[transform*="rotate"]')).some((g) => g.getAttribute('fill') === 'none')).toBe(false);
  });
});

describe('no data', () => {
  it('draws "checked, nothing found" as a clear hexagon with a black foot, and never green', () => {
    const t: TrailTile[] = [{ id: 'a', label: 'A', state: 'clear' }, { id: 'b', label: 'B', state: 'held', depth: 1 }];
    const { container } = render(<FootprintTrail tiles={t} ariaLabel="Two" />);
    const hex = Array.from(container.querySelectorAll('polygon'));
    expect(hex[0].getAttribute('fill')).toBe('none');
    expect(hex[0].getAttribute('stroke')).not.toMatch(/^#(1e7a40|9bd3ad)/);
    const blackFoot = Array.from(container.querySelectorAll('g[transform*="rotate"]')).some((g) => g.getAttribute('fill') === '#111111');
    expect(blackFoot).toBe(true);
  });
  it('keeps "not checked yet" white with no foot, so it is not mistaken for "nothing found"', () => {
    const { container } = render(<FootprintTrail tiles={[{ id: 'a', label: 'A', state: 'notyet' }]} ariaLabel="One" />);
    expect(container.querySelector('polygon')?.getAttribute('fill')).toBe('#ffffff');
    expect(container.querySelectorAll('g[transform*="rotate"]').length).toBe(0);
  });
});

describe('green depth', () => {
  it('lets a tile we certainly hold be dark green whatever the prints do', () => {
    const t: TrailTile[] = [{ id: 'a', label: 'A', state: 'held', depth: 1 }, { id: 'b', label: 'B', state: 'held', depth: 0 }];
    const { container } = render(<FootprintTrail tiles={t} ariaLabel="Two" />);
    const fills = Array.from(container.querySelectorAll('polygon')).map((x) => x.getAttribute('fill'));
    expect(fills[0]).toBe('#5cbf7f');
    expect(fills[1]).toBe('#e6f6ea');
  });
});

describe('PathTrailPreview: the other seven groups', () => {
  it('shows all seven groups with every tile', () => {
    render(<PathTrailPreview />);
    const grid = screen.getByTestId('path-trail-groups');
    expect(grid.querySelectorAll('figure')).toHaveLength(7);
    // 12 + 3 + 5 + 5 + 5 + 6 + 6 tiles
    expect(grid.querySelectorAll('[role=img]')).toHaveLength(42);
  });
  it('shows the no-data states in the samples: a clear hexagon, and a tile that cannot be checked here', () => {
    render(<PathTrailPreview />);
    expect(screen.getByLabelText('Mixed Content: Checked, nothing found')).toBeTruthy();
    expect(screen.getByLabelText("Motion Sensors: Can't check from here")).toBeTruthy();
  });
});

describe('PathTrailPreview', () => {
  it('says it is a preview with example data and always shows Web and Email', () => {
    render(<PathTrailPreview />);
    expect(screen.getByText(/Example, not your data/)).toBeTruthy();
    expect(screen.getByLabelText(/^Web: we hold it/)).toBeTruthy();
    expect(screen.getByLabelText('Email: Not checked yet')).toBeTruthy();
  });
  it('shows where the visitor came from and the three things we do not know', () => {
    render(<PathTrailPreview />);
    expect(screen.getByLabelText(/^How You Found Us: Where you came from/)).toBeTruthy();
    for (const l of ['First name', 'Username', 'Mobile number']) expect(screen.getByLabelText(`${l}: We don't know this`)).toBeTruthy();
  });
  it('holds Email once the visitor signs up (example toggle)', () => {
    render(<PathTrailPreview />);
    fireEvent.click(screen.getByLabelText(/Pretend I signed up/));
    expect(screen.getByLabelText(/^Email: we hold it/)).toBeTruthy();
  });
  it('switches between the examples: first visit shows no data, deleting removes a tile', () => {
    render(<PathTrailPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'First visit' }));
    expect(screen.getAllByLabelText(/Not checked yet/).length).toBeGreaterThanOrEqual(12);
    fireEvent.click(screen.getByRole('button', { name: 'Deleting data' }));
    expect(screen.queryByLabelText(/^Connected Devices:/)).toBeNull();
  });
});
