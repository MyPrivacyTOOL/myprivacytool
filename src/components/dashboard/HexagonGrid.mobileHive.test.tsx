import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HexagonGrid } from './HexagonGrid';
import type { Hexagon, ScanResult } from '@/types/hexagon';

const width = vi.hoisted(() => ({ value: 390 }));
vi.mock('@/hooks/useElementWidth', () => ({ useElementWidth: () => width.value }));
const trackEvent = vi.fn();
const trackExposure = vi.fn();
vi.mock('@/lib/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics');
  return { ...actual, trackEvent: (...a: unknown[]) => trackEvent(...a), trackExperimentExposure: (...a: unknown[]) => trackExposure(...a) };
});

const hex = (id: string): Hexagon => ({
  id, pillar: 'device', label: `Tile ${id}`, status: 'checked', data: `Value ${id}`, source: 's', confidence_score: 0.9, remediation: 'n/a', exposure: false,
});
const data: ScanResult = { hexagons: [hex('a'), hex('b'), hex('c')] };
const noop = () => {};
const view = (path: string) => {
  window.history.replaceState({}, '', path);
  return render(<HexagonGrid scanResult={data} onConfirm={noop} onDispute={noop} onSelect={noop} />);
};

beforeEach(() => { vi.clearAllMocks(); width.value = 390; window.sessionStorage.clear(); });
afterEach(() => window.history.replaceState({}, '', '/'));

describe('dashboard HexagonGrid mobile_hive', () => {
  it('control on a phone: no value line, and the layout is reported as values_shown=false', () => {
    view('/?ab_mobile_hive=control');
    expect(screen.queryByText('Value a')).toBeNull();
    expect(trackExposure).toHaveBeenCalledWith('mobile_hive', 'control', true); // forced preview: the helper itself drops it
  });

  it('readable_tiles on a phone: every tile shows its value', () => {
    view('/?ab_mobile_hive=readable_tiles');
    for (const id of ['a', 'b', 'c']) expect(screen.getByText(`Value ${id}`)).toBeInTheDocument();
  });

  it('forced (QA) views send no hive event; a wide container is not a phone and sends nothing', () => {
    view('/?ab_mobile_hive=readable_tiles');
    expect(trackEvent).not.toHaveBeenCalledWith('hive_values_rendered', expect.anything());
    vi.clearAllMocks();
    width.value = 800;
    view('/?ab_mobile_hive=readable_tiles');
    expect(trackExposure).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
