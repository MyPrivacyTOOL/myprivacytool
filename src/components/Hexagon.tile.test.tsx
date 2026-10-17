import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Hexagon from './Hexagon';
import { toTile } from '@/lib/hexagonTile';
import type { HexagonData } from '@/lib/deviceDetection';

const hex = (over: Partial<HexagonData> = {}): HexagonData => ({
  id: 'webrtc-leak', label: 'WebRTC Leak', value: 'No Leak Detected', icon: '🌐', confidence: 99, risk: 'r', confirmed: false, ...over,
});
const noop = () => {};

describe('Hexagon tile (MPC-7916)', () => {
  it('without a tile it looks as before: percentage and tap to confirm', () => {
    render(<Hexagon data={hex()} onConfirm={noop} onHover={noop} />);
    const b = screen.getByRole('button');
    expect(b.getAttribute('aria-label')).toMatch(/Confidence: 99%/);
    expect(b.textContent).toMatch(/99%/);
  });

  it('a could-not-check tile shows no percentage and not the detector value, in the text or the aria label', () => {
    const data = hex();
    const tile = toTile({ id: data.id, value: data.value });
    expect(tile.kind).toBe('couldnt_check');
    const { container } = render(<Hexagon data={data} onConfirm={noop} onHover={noop} tile={tile} />);
    const b = screen.getByRole('button');
    expect(b.textContent).not.toMatch(/%/);
    expect(b.textContent).not.toMatch(/No Leak Detected/);
    expect(b.getAttribute('aria-label')).not.toMatch(/%|Confidence|Confirmed|No Leak Detected/);
    expect(screen.getByTestId('tile-line')).toHaveTextContent("Couldn't check");
    expect(b.getAttribute('aria-pressed')).toBeNull();
    expect(container.querySelector('[data-tile-kind="couldnt_check"]')).not.toBeNull();
  });

  it('a found, medium-risk tile says Needs fixing and shows its real value', () => {
    const data = hex({ id: 'canvas-fingerprint', label: 'Canvas Fingerprint', value: 'Vale Tulip' });
    const tile = toTile({ id: data.id, value: data.value });
    render(<Hexagon data={data} onConfirm={noop} onHover={noop} tile={tile} />);
    const b = screen.getByRole('button');
    expect(b.textContent).toMatch(/Vale Tulip/);
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Needs fixing');
    expect(b.textContent).not.toMatch(/%/);
  });

  it('a guess breathes, a tap still reports as before, and it is never drawn as confirmed', () => {
    const onConfirm = vi.fn();
    const data = hex({ id: 'location', label: 'Location', value: 'Springfield, England' });
    const tile = toTile({ id: data.id, value: data.value });
    render(<Hexagon data={{ ...data, confirmed: false }} onConfirm={onConfirm} onHover={noop} tile={tile} />);
    const b = screen.getByRole('button');
    expect(b.getAttribute('class')).toMatch(/tile-breathe/);
    expect(screen.getByTestId('tile-line')).toHaveTextContent('Our guess');
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith('location');
  });

  it('a tapped tile never gets the confirmed tick', () => {
    const data = hex({ id: 'location', label: 'Location', value: 'Springfield', confirmed: true });
    const tile = toTile({ id: data.id, value: data.value });
    const { container } = render(<Hexagon data={data} onConfirm={noop} onHover={noop} tile={tile} />);
    expect(container.querySelector('.animate-hexagon-confirm')).toBeNull();
    expect(container.querySelector('.confirmed')).toBeNull();
  });
});

describe('Hexagon tile icon (MPC-7916)', () => {
  it('a grey tile never keeps a green-tick icon', () => {
    const data = hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', icon: '✅' });
    const tile = toTile({ id: data.id, value: data.value });
    const { container } = render(<Hexagon data={data} onConfirm={noop} onHover={noop} tile={tile} />);
    expect(container.textContent).not.toMatch(/✅/);
    expect(container.textContent).toMatch(/🔓/);
  });
});
