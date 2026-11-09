import { describe, expect, it } from 'vitest';
import { parsePathTrail, pathTrailEnabled } from './pathTrail';

describe('the path trail switch', () => {
  it('is off unless clearly on', () => {
    for (const v of [undefined, null, '', 'false', '0', 'no', 'maybe', 5]) expect(parsePathTrail(v)).toBe(false);
    for (const v of ['true', '1', 'on', 'yes', ' TRUE ']) expect(parsePathTrail(v)).toBe(true);
  });
  it('can be previewed in one tab with ?path=1 and nothing else', () => {
    expect(pathTrailEnabled('?path=1')).toBe(true);
    expect(pathTrailEnabled('?a=1&path=1')).toBe(true);
    expect(pathTrailEnabled('?path=10')).toBe(false);
    expect(pathTrailEnabled('')).toBe(false);
  });
});
