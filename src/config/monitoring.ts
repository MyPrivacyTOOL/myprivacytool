// Continuous monitoring dashboard switch (MPC-7649). The dashboard has no live data source yet (no user accounts and
// no checkout), so it is OFF in production. It shows, with sample data, only when VITE_MONITORING_ENABLED is
// "true" at build time, or on local dev / a Cloudflare Pages preview host.
export function parseMonitoringEnabled(raw: unknown): boolean {
  return typeof raw === "string" && ["true", "1", "on", "yes"].includes(raw.trim().toLowerCase());
}

export const MONITORING_ENABLED: boolean = parseMonitoringEnabled(import.meta.env.VITE_MONITORING_ENABLED);

export function isMonitoringPreviewHost(hostname: string, dev: boolean): boolean {
  return dev || hostname === "localhost" || hostname.endsWith(".pages.dev");
}

export function monitoringVisible(): boolean {
  if (MONITORING_ENABLED) return true;
  if (typeof window === "undefined") return false;
  return isMonitoringPreviewHost(window.location.hostname, import.meta.env.DEV === true);
}
