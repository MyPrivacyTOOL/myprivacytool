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
  it('a silent bin no longer wipes out the bins before it', () => {
    const real = new Float32Array(512).map((_, i) => -90 + (i % 17) * 1.3);
    const withSilentTail = new Float32Array(real);
    withSilentTail[511] = -Infinity;
    const hash = audioSignalHash(withSilentTail);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hash).not.toMatch(/^0+$/);
    // the same data with that bin as 0 hashes the same: a silent bin counts as 0, it does not reset the hash
    const withZeroTail = new Float32Array(real);
    withZeroTail[511] = 0;
    expect(hash).toBe(audioSignalHash(withZeroTail));
  });
  it('one finite bin among silent ones still counts as a read', () => {
    const data = new Float32Array(64).fill(-Infinity);
    data[10] = -61.5;
    expect(audioSignalHash(data)).not.toBeNull();
  });
  it('the status rule treats an all-zero audio value as not checked, and a real one as found', () => {
    expect(captureStatus('audio-fingerprint', '00000000...')).toBe('not_checked');
    expect(captureStatus('audio-fingerprint', '00000000')).toBe('not_checked');
    expect(captureStatus('audio-fingerprint', 'a3f9c21e...')).toBe('found');
  });
});
