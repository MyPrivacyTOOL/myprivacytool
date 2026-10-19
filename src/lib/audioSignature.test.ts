import { describe, it, expect } from 'vitest';
import { audioSignalHash } from './fingerprintDetection';
import { captureStatus } from '../../shared/hexagon-registry/status.js';

describe('audio signature (CK-8321)', () => {
  it('a silent, suspended or blocked context (-Infinity or NaN in every bin) is not a read', () => {
    expect(audioSignalHash(new Float32Array(512).fill(-Infinity))).toBeNull();
    expect(audioSignalHash(new Float32Array(512).fill(NaN))).toBeNull();
    expect(audioSignalHash([])).toBeNull();
  });
  it('real frequency data still gives an 8-character hash that is not all zeros', () => {
    const data = new Float32Array(512).map((_, i) => -90 + (i % 17) * 1.3);
    const hash = audioSignalHash(data);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hash).not.toMatch(/^0+$/);
  });
  it('a read that is almost all silence and hashes to zeros is not a read either', () => {
    // each -Infinity bin resets the hash, so one finite bin followed by silence still ends as 00000000
    const data = new Float32Array(64).fill(-Infinity);
    data[10] = -61.5;
    expect(audioSignalHash(data)).toBeNull();
  });
  it('the status rule treats an all-zero audio value as not checked, and a real one as found', () => {
    expect(captureStatus('audio-fingerprint', '00000000...')).toBe('not_checked');
    expect(captureStatus('audio-fingerprint', '00000000')).toBe('not_checked');
    expect(captureStatus('audio-fingerprint', 'a3f9c21e...')).toBe('found');
  });
});
