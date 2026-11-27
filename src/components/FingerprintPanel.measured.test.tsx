// CK-8324: the old grid's fingerprint panel shows only what the scan read. No "N% unique", no "1 in N", no estimate.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measuredAdvanced, measuredFingerprint } from '@/lib/measuredOnly';
import FingerprintPanel from './FingerprintPanel';

const core = {
  canvas: { technique: 'Canvas', hash: 'canvashash0123456789', risk: 'high' },
  webgl: { technique: 'WebGL', hash: 'webglhash', renderer: 'Test Renderer', vendor: 'Test Vendor', extensions: [], risk: 'high' },
  audio: { technique: 'Audio', hash: 'audiohash0123456789', sampleRate: 44100, risk: 'medium' },
  fonts: { technique: 'Fonts', count: 12, uniqueFonts: [], risk: 'medium' },
  plugins: { technique: 'Plugins', pluginCount: 3, plugins: [], adBlocker: false, risk: 'low' },
  uniqueness: '1 in 4.4T',
  totalRisk: 'high',
  compositeHash: 'composite',
};
const screenRead = { technique: 'Screen', resolution: '1920x1080', colorDepth: 24, pixelRatio: 2, availableResolution: '1920x1040', uniqueness: 85, risk: 'medium' };

vi.mock('@/lib/fingerprintDetection', () => ({
  calculateFingerprintUniqueness: async () => core,
  detectWebRTCLeak: async () => ({ localIPs: [], publicIPs: [], isLeaking: false, vpnDetected: false, risk: 'low', technique: 'WebRTC', state: 'timed_out', detectorVersion: 't' }),
  detectHardwareConcurrency: () => ({ cores: 8, memory: 8, hardwareClass: 'high', risk: 'low', technique: 'Hardware' }),
  detectScreenProperties: () => screenRead,
  detectTimezoneLocale: () => ({ timezone: 'Asia/Hong_Kong', offset: -480, dateFormat: 'd', numberFormat: 'n', mismatch: false, risk: 'medium', technique: 'Timezone' }),
  detectBatteryStatus: async () => ({ level: 50, charging: true, available: true, chargingTime: null, dischargingTime: null, risk: 'low', technique: 'Battery' }),
  detectMediaDevices: async () => ({ videoInputs: 1, audioInputs: 2, audioOutputs: 1, deviceLabels: [], permissionGranted: false, risk: 'medium', technique: 'MediaDevices' }),
}));

afterEach(cleanup);

describe('FingerprintPanel shows only what was read (CK-8324)', () => {
  it('renders the readings and no uniqueness figure', async () => {
    const { container } = render(<FingerprintPanel />);
    expect(await screen.findByText('Test Renderer')).toBeTruthy();
    expect(screen.getByText('Fonts detected: 12')).toBeTruthy();
    expect(screen.getByText('1920x1080, 2x pixel ratio, 24-bit color')).toBeTruthy();
    expect(screen.getByText('Signals read from this browser: 11')).toBeTruthy();
    // A check that did not finish must not read as a clean result.
    expect(screen.getByText("Check didn't finish")).toBeTruthy();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/%\s*unique|\b1 in [\d,]|very unique|somewhat unique|compare with others|test uniqueness|highest impact/i);
  });

  it('keeps the estimate out of the exported report', async () => {
    const parts: string[] = [];
    const RealBlob = globalThis.Blob;
    vi.stubGlobal('Blob', class extends RealBlob {
      constructor(chunks: BlobPart[], options?: BlobPropertyBag) { super(chunks, options); parts.push(String(chunks[0])); }
    });
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<FingerprintPanel />);
    fireEvent.click(await screen.findByText('Export Full Report (JSON)'));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('Test Renderer');
    expect(parts[0]).not.toMatch(/uniqueness|1 in /i);
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('measuredOnly', () => {
  it('drops the estimate and the screen heuristic without changing the input', () => {
    const fp = measuredFingerprint(core as never);
    const adv = measuredAdvanced({ screen: screenRead as never, other: 1 });
    expect('uniqueness' in fp).toBe(false);
    expect('uniqueness' in (adv.screen as object)).toBe(false);
    expect(adv.other).toBe(1);
    expect(core.uniqueness).toBe('1 in 4.4T');
    expect(screenRead.uniqueness).toBe(85);
  });
});

describe('source guard (CK-8324)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  it('the panel has no hard-coded uniqueness values and no derived "1 in N"', () => {
    const src = read('src/components/FingerprintPanel.tsx');
    for (const banned of ['% unique', '1 in ', 'uniqueness:', 'fingerprint.uniqueness', 'uniquenessScore', 'FingerprintComparison', 'Very Unique', 'more unique']) {
      expect(src).not.toContain(banned);
    }
  });
  it('the verification card does not read, store or compare the estimate', () => {
    const src = read('src/components/FingerprintVerification.tsx');
    for (const banned of ['.uniqueness', "'uniqueness'", 'uniqueness:', '1 in ', 'more unique', 'less unique', 'Uniqueness Change', 'Test Uniqueness']) {
      expect(src).not.toContain(banned);
    }
  });
});
