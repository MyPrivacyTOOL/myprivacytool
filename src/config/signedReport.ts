// Signed report download (MPC-8281). OFF by default. Turn it on for a build with VITE_SIGNED_REPORT="true" (also "1", "on", "yes").
// The button also needs the Level 2 gate (proof of possession, MPC-7902) to be passed, and the server refuses to sign without it,
// so this switch alone never produces a signed file. Read at call time so tests can change it.

export function parseSignedReport(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function signedReportEnabled(): boolean {
  return parseSignedReport(import.meta.env.VITE_SIGNED_REPORT);
}
