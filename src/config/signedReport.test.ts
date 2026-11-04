import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSignedReport, signedReportEnabled } from './signedReport';

afterEach(() => vi.unstubAllEnvs());

describe('signed report switch', () => {
  it('is off unless set to a true-like value', () => {
    expect(parseSignedReport(undefined)).toBe(false);
    expect(parseSignedReport('')).toBe(false);
    expect(parseSignedReport('false')).toBe(false);
    for (const v of ['true', '1', 'on', 'YES', ' True ']) expect(parseSignedReport(v)).toBe(true);
  });
  it('reads VITE_SIGNED_REPORT at call time', () => {
    expect(signedReportEnabled()).toBe(false);
    vi.stubEnv('VITE_SIGNED_REPORT', 'true');
    expect(signedReportEnabled()).toBe(true);
  });
});
