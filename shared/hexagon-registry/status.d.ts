export type CaptureStatus = 'found' | 'clear' | 'not_checked';
export const CAPTURE_STATUS: { FOUND: 'found'; CLEAR: 'clear'; NOT_CHECKED: 'not_checked' };
export function captureStatus(id: string, value: string, ctx?: { connectionIsMeasured?: boolean; browserKnown?: boolean }): CaptureStatus;
export function isEstimate(id: string): boolean;
