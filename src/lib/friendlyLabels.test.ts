import { describe, it, expect } from 'vitest';
import { nicknameFromHash, friendlyGraphics } from './friendlyLabels';

describe('friendly labels (CK-7805)', () => {
  it('gives the same nickname for the same hash and never shows hash characters', () => {
    const n = nicknameFromHash('a3f9c1d2e4b5');
    expect(nicknameFromHash('a3f9c1d2e4b5')).toBe(n);
    expect(n).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(n).not.toMatch(/[0-9]/);
  });
  it('falls back for a missing or short hash', () => {
    expect(nicknameFromHash('')).toBe('Your browser');
    expect(nicknameFromHash('zz')).toBe('Your browser');
  });
  it('names the graphics family and never returns the raw renderer string', () => {
    expect(friendlyGraphics('ANGLE (Apple, Apple M1, OpenGL 4.1)')).toBe('Apple graphics');
    expect(friendlyGraphics('NVIDIA GeForce RTX 3060')).toBe('NVIDIA graphics');
    expect(friendlyGraphics('Mali-G78')).toBe('ARM graphics');
    expect(friendlyGraphics('SomeUnknown Renderer 9000')).toBe('Your graphics');
    expect(friendlyGraphics('Unknown')).toBe('Your graphics');
  });
});
