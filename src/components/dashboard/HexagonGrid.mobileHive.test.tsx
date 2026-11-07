import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HexagonGrid } from './HexagonGrid';
import type { Hexagon, ScanResult } from '@/types/hexagon';

const width = vi.hoisted(() => ({ value: 390 }));
const assignment = vi.hoisted(() => ({ value: { experimentId: 'mobile_hive', variantId: 'readable_tiles', forced: false, active: true } }));
vi.mock('@/hooks/useElementWidth', () => ({ useElementWidth: () => width.value }));
vi.mock('@/hooks/useExperiment', () => ({ useExperiment: () => assignment.value }));
const trackEvent = vi.fn();
const trackExposure = vi.fn();
vi.mock('@/lib/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics');
  return { ...actual, trackEvent: (...a: unknown[]) => trackEvent(...a), trackExperimentExposure: (...a: unknown[]) => trackExposure(...a) };
});

const hex = (id: string, pillar: string, o: Partial<Hexagon> = {}): Hexagon => ({
  id, pillar, label: `Tile ${id}`, status: 'checked', data: `Value ${id}`, source: 's', confidence_score: 0.9, remediation: 'n/a', exposure: false, ...o,
});
// Two pillars, so a per-pillar event would fire twice. One tile has no data and so shows no value line.
const data: ScanResult = { hexagons: [hex('a', 'security'), hex('b', 'security'), hex('c', 'contact'), hex('d', 'contact', { data: undefined })] };
const noop = () => {};
const view = () => render(<HexagonGrid scanResult={data} onConfirm={noop} onDispute={noop} onSelect={noop} />);
const setAssignment = (o: Partial<typeof assignment.value>) => { assignment.value = { ...assignment.value, ...o }; };

beforeEach(() => {
  vi.clearAllMocks();
  width.value = 390;
  assignment.value = { experimentId: 'mobile_hive', variantId: 'readable_tiles', forced: false, active: true };
});

describe('dashboard HexagonGrid mobile_hive', () => {
  it('readable_tiles on a phone: tiles show their values', () => {
    view();
    for (const id of ['a', 'b', 'c']) expect(screen.getByText(`Value ${id}`)).toBeInTheDocument();
  });

  it('control on a phone: no value line', () => {
    setAssignment({ variantId: 'control' });
    view();
    expect(screen.queryByText('Value a')).toBeNull();
  });

  it('sends ONE exposure and ONE hex_value_rendered for the whole grid, counting tiles that show a value', () => {
    view();
    expect(trackExposure).toHaveBeenCalledTimes(1);
    expect(trackExposure).toHaveBeenCalledWith('mobile_hive', 'readable_tiles', false);
    const sent = trackEvent.mock.calls.filter((c) => c[0] === 'hex_value_rendered');
    expect(sent).toEqual([['hex_value_rendered', { experiment_id: 'mobile_hive', variant_id: 'readable_tiles', hexes_with_value: 3 }]]);
  });

  it('control reports zero tiles with a value (the baseline the test group is compared with)', () => {
    setAssignment({ variantId: 'control' });
    view();
    expect(trackEvent).toHaveBeenCalledWith('hex_value_rendered', { experiment_id: 'mobile_hive', variant_id: 'control', hexes_with_value: 0 });
  });

  it('sends nothing for a wide container, a forced QA view, or a flag that is off', () => {
    width.value = 800;
    view();
    expect(trackExposure).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();

    width.value = 390;
    setAssignment({ forced: true, active: false });
    view();
    expect(trackEvent).not.toHaveBeenCalledWith('hex_value_rendered', expect.anything());

    vi.clearAllMocks();
    setAssignment({ forced: false, active: false, variantId: 'control' });
    view();
    expect(trackExposure).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
