import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VoiceAI from './VoiceAI';
import { toTile } from '@/lib/hexagonTile';
import type { HexagonData } from '@/lib/deviceDetection';
import * as analytics from '@/lib/analytics';
import { getVoiceData } from '@/lib/voiceStorage';

vi.mock('@/lib/analytics', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? vi.fn() : v]));
});

// What Alice says aloud (the Voice AI button): captured from the utterance handed to speechSynthesis.
let spoken: string[] = [];
let utterances: { text: string; onend: (() => void) | null }[] = [];
beforeEach(() => {
  spoken = [];
  utterances = [];
  vi.mocked(analytics.trackVoiceScanCompleted).mockClear();
  class Utterance { text: string; rate = 1; pitch = 1; volume = 1; onend: (() => void) | null = null; voice: unknown; constructor(t: string) { this.text = t; } }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: (u: { text: string; onend: (() => void) | null }) => { spoken.push(u.text); utterances.push(u); } });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const hex = (over: Partial<HexagonData> = {}): HexagonData => ({
  id: 'device', label: 'Device Type', value: 'Desktop (Windows 11)', icon: '💻', confidence: 92, risk: 'r', confirmed: false, category: 'device', ...over,
});
const press = () => fireEvent.click(screen.getByRole('button', { name: /voice ai/i }));

describe('VoiceAI spoken text with tiles on', () => {
  it('the intro has no count, no "without asking", no score and no "click to confirm"', () => {
    vi.stubEnv('VITE_HEX_TILE_V2', 'true');
    render(<VoiceAI hexagonData={null} confirmedCount={0} totalCount={5} />);
    press();
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/I look at what your browser tells every website/);
    expect(spoken[0]).not.toMatch(/\d|%|without asking|data points|click to confirm|risk score/i);
  });

  it('for a tile that makes no claim she says why, with no value, percentage or risk score', () => {
    vi.stubEnv('VITE_HEX_TILE_V2', 'true');
    const h = hex({ id: 'dns-leak', label: 'DNS Leak', value: 'No Leak Detected', confidence: 100, category: 'security' });
    render(<VoiceAI hexagonData={h} tile={toTile({ id: h.id, value: h.value })} confirmedCount={2} totalCount={5} />);
    press();
    expect(spoken[0]).toMatch(/DNS Leak: A web page can't check this/);
    expect(spoken[0]).not.toMatch(/No Leak|100|%|Confidence|click to confirm|risk score|looks normal/i);
  });

  it('with the flag off she still gives the old structured response', () => {
    render(<VoiceAI hexagonData={null} confirmedCount={0} totalCount={5} />);
    press();
    expect(spoken[0]).toMatch(/Alice/);
    expect(spoken[0]).not.toMatch(/I look at what your browser tells every website/);
  });

  it('logs, stores and shows no tap-derived risk score or completed scan, even when every tile has been tapped', () => {
    vi.stubEnv('VITE_HEX_TILE_V2', 'true');
    const { container } = render(<VoiceAI hexagonData={null} confirmedCount={5} totalCount={5} />);
    press();
    utterances[0].onend?.();
    expect(analytics.trackVoiceScanCompleted).not.toHaveBeenCalled();
    const stored = getVoiceData();
    expect(stored.bestRiskScore).toBe(100);
    expect(stored.totalScansCompleted).toBe(0);
    expect(container.textContent).not.toMatch(/Best:|\bscans?\b/);
    expect(screen.queryByText(/Best:/)).toBeNull();
  });

  it('with the flag off the old completed-scan tracking and stored best score still happen', () => {
    render(<VoiceAI hexagonData={null} confirmedCount={5} totalCount={5} />);
    press();
    utterances[0].onend?.();
    expect(analytics.trackVoiceScanCompleted).toHaveBeenCalledTimes(1);
    expect(getVoiceData().totalScansCompleted).toBe(1);
  });
});
