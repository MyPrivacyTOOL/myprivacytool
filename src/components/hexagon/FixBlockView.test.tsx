import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FixBlockView from './FixBlockView';
import NextStepCard from './NextStepCard';
import { RemediationPanel } from '@/components/modals/RemediationPanel';
import { fixBlockFor, noActionReason, type FixBlock } from '@/lib/hexagonFix';
import { declareJurisdiction } from '@/lib/declaredJurisdiction';
import { fixBlocksV2Enabled } from '@/config/hexagonTile';
import type { Hexagon } from '@/types/hexagon';

afterEach(() => {
  cleanup();
  declareJurisdiction(null);
  vi.unstubAllEnvs();
});

const hex = (over: Partial<Hexagon>): Hexagon => ({ id: 'webrtc-leak', pillar: 'x', label: 'WebRTC Leak', status: 'checked', data: 'x', source: 'web-scan', remediation: 'Old generic text.', ...over });

describe('FixBlockView (MPC-8745)', () => {
  it('shows why, the steps and the draft note', () => {
    render(<FixBlockView block={fixBlockFor('webrtc-leak') as FixBlock} />);
    expect(screen.getByTestId('fix-block').textContent).toMatch(/WebRTC/);
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(screen.getByTestId('fix-draft-note')).toBeTruthy();
    expect(screen.queryByTestId('fix-region')).toBeNull();
  });
  it('a region block shows generic text until the visitor declares a jurisdiction, then follows only that choice', () => {
    render(<FixBlockView block={fixBlockFor('isp') as FixBlock} />);
    expect(screen.getByTestId('fix-region-text').textContent).toMatch(/privacy team/);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hong_kong' } });
    expect(screen.getByTestId('fix-region-text').textContent).toMatch(/PDPO/);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(screen.getByTestId('fix-region-text').textContent).toMatch(/privacy team/);
  });
  it('the picker offers every declared jurisdiction and "prefer not to say", nothing else', () => {
    render(<FixBlockView block={fixBlockFor('location') as FixBlock} />);
    expect(screen.getAllByRole('option')).toHaveLength(8);
  });
});

describe('NextStepCard with a block', () => {
  it('prefers the block over the old step', () => {
    render(<NextStepCard label="WebRTC Leak" block={fixBlockFor('webrtc-leak')} step={{ why: 'OLD', steps: ['old'] }} position={1} total={1} onDone={() => {}} onLater={() => {}} />);
    expect(screen.getByTestId('fix-block')).toBeTruthy();
    expect(screen.queryByText('OLD')).toBeNull();
  });
  it('without a block it still shows the old step', () => {
    render(<NextStepCard label="x" step={{ why: 'OLD', steps: ['old'] }} position={1} total={1} onDone={() => {}} onLater={() => {}} />);
    expect(screen.queryByTestId('fix-block')).toBeNull();
    expect(screen.getByText('OLD')).toBeTruthy();
  });
});

describe('RemediationPanel behind the fix-blocks switch', () => {
  const panel = (h: Hexagon) => render(<RemediationPanel hexagon={h} isOpen onClose={() => {}} onMarkFixed={() => {}} />);
  it('is unchanged when the switch is off', () => {
    expect(fixBlocksV2Enabled('')).toBe(false);
    panel(hex({ tile: 'needs_fixing' }));
    expect(screen.queryByTestId('fix-block')).toBeNull();
    expect(screen.getByText('Old generic text.')).toBeTruthy();
  });
  it('shows the block on a red tile when the switch is on', () => {
    vi.stubEnv('VITE_FIX_BLOCKS_V2', 'true');
    panel(hex({ tile: 'needs_fixing' }));
    expect(screen.getByTestId('fix-block')).toBeTruthy();
  });
  it('shows a block for a guess the visitor said yes to, but not for an unanswered guess', () => {
    vi.stubEnv('VITE_FIX_BLOCKS_V2', 'true');
    panel(hex({ id: 'isp', label: 'Internet Provider', tile: 'our_guess', status: 'confirmed' }));
    expect(screen.getByTestId('fix-block')).toBeTruthy();
    cleanup();
    panel(hex({ id: 'isp', label: 'Internet Provider', tile: 'our_guess', status: 'guess' }));
    expect(screen.queryByTestId('fix-block')).toBeNull();
  });
  it('a hexagon with no fix step shows its reason, never a block', () => {
    vi.stubEnv('VITE_FIX_BLOCKS_V2', 'true');
    panel(hex({ id: 'screen', label: 'Screen Resolution', tile: 'seen_low_risk' }));
    expect(screen.queryByTestId('fix-block')).toBeNull();
    expect(screen.getByText(noActionReason('screen') as string)).toBeTruthy();
  });
  it('the query-string switch works for one tab', () => {
    expect(fixBlocksV2Enabled('?fix_v2=1')).toBe(true);
    expect(fixBlocksV2Enabled('?fix_v2=0')).toBe(false);
  });
});
