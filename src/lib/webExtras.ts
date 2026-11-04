// MPC-8689 pilot: the extra web hexagons. Built and checked, but NOT part of the 54 web hexagons: they are kept out of the exposure score, scanCounts and every
// saved scan until the owner approves a new score version. Same honesty rules as the 54: found / clear / not_checked, never a guess; a browser that does not offer
// a value is "not checked", not "clear". Nothing here is stored or sent anywhere (the edge data comes from our own Worker, which already sees the request).
// Built from the discovery list (access OK): postal area, IP timezone, network distance, network owner, TLS fingerprint, HTTP version, EU flag (all from Cloudflare's
// request data via GET /whoami-extra), exact device model (client hints) and clock offset. Not built: reverse DNS (would show the visitor's IP to a third-party DNS
// resolver, which MPC-7350 rules out) and the four permission-prompt checks (GPS, camera and microphone names, notifications, contacts and clipboard), which need new prompts.
import { WEB_EXTRA_IDS } from '../../shared/hexagon-registry/channels.js';

export type ExtraStatus = 'found' | 'clear' | 'not_checked';
export interface WebExtra { id: string; label: string; status: ExtraStatus; value?: string; reason?: string }
export { WEB_EXTRA_IDS };

export const webExtrasEnabled = (): boolean => import.meta.env.VITE_WEB_EXTRAS === 'true'; // default off

const LABELS: Record<string, string> = {
  'web.postal_area': 'Postal area', 'web.ip_timezone': 'IP timezone vs device clock', 'web.network_distance': 'Network distance', 'web.network_owner': 'Network owner type',
  'web.tls_fingerprint': 'TLS handshake fingerprint', 'web.http_protocol': 'HTTP version', 'web.eu_region': 'EU visitor flag', 'web.device_model': 'Exact device model and OS version', 'web.clock_skew': 'Device clock offset',
};
const mk = (id: string, status: ExtraStatus, extra: { value?: string; reason?: string } = {}): WebExtra => ({ id, label: LABELS[id], status, ...extra });

export interface EdgeExtra {
  postal_code?: string; metro_code?: string; timezone?: string; tcp_rtt_ms?: number | null; quic_rtt_ms?: number | null; colo?: string; asn?: number | null; org?: string;
  tls_ciphers_sha1?: string; tls_extensions_sha1?: string; tls_hello_length?: number | null; http_protocol?: string; is_eu?: boolean | null; continent?: string; region_code?: string; now?: number;
}
interface UaData { getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>; mobile?: boolean; platform?: string }
export interface ExtraEnv { deviceTimeZone?: string; nowMs?: number; userAgentData?: UaData | null }

const NOT_CHECKED_EDGE = 'the connection data could not be read just now';
const short = (h?: string): string => (h ? `${h.slice(0, 8)}…` : '');

/** Pure: builds the seven edge hexagons and the clock offset from the Worker's answer and the browser's own values. `edge` null = the Worker could not be reached. */
export function edgeExtras(edge: EdgeExtra | null, env: ExtraEnv = {}): WebExtra[] {
  if (!edge) return ['web.postal_area', 'web.ip_timezone', 'web.network_distance', 'web.network_owner', 'web.tls_fingerprint', 'web.http_protocol', 'web.eu_region', 'web.clock_skew'].map((id) => mk(id, 'not_checked', { reason: NOT_CHECKED_EDGE }));
  const out: WebExtra[] = [];
  out.push(edge.postal_code
    ? mk('web.postal_area', 'found', { value: `Your connection appears to be near postcode ${edge.postal_code}${edge.metro_code ? ` (metro area ${edge.metro_code})` : ''}. It comes from your internet address, so it can be the provider's area and not your home.` })
    : mk('web.postal_area', 'clear'));
  if (edge.timezone) {
    const dev = env.deviceTimeZone;
    out.push(mk('web.ip_timezone', 'found', { value: dev && dev !== edge.timezone ? `Your internet address says ${edge.timezone} but your device clock says ${dev}. A difference often means a VPN, a proxy or travel.` : `Your internet address and your device clock agree (${edge.timezone}).` }));
  } else out.push(mk('web.ip_timezone', 'not_checked', { reason: 'no timezone for this connection' }));
  const rtt = edge.tcp_rtt_ms ?? edge.quic_rtt_ms;
  out.push(typeof rtt === 'number' ? mk('web.network_distance', 'found', { value: `Your connection reaches our nearest server${edge.colo ? ` (${edge.colo})` : ''} in about ${rtt} ms. A long delay can mean you are further away than your address suggests.` }) : mk('web.network_distance', 'not_checked', { reason: 'no timing for this connection' }));
  out.push(edge.org || edge.asn ? mk('web.network_owner', 'found', { value: `Your connection belongs to ${edge.org || 'an unnamed network'}${edge.asn ? ` (AS${edge.asn})` : ''}. Hosting and VPN networks look different from home internet.` }) : mk('web.network_owner', 'not_checked', { reason: 'no network owner for this connection' }));
  out.push(edge.tls_ciphers_sha1 ? mk('web.tls_fingerprint', 'found', { value: `Your browser's secure-connection handshake has a fingerprint (${short(edge.tls_ciphers_sha1)}). Browsers and systems of the same kind share it, so it helps recognise software, not one person.` }) : mk('web.tls_fingerprint', 'not_checked', { reason: 'no handshake data for this connection' }));
  out.push(edge.http_protocol ? mk('web.http_protocol', 'found', { value: `Your browser used ${edge.http_protocol}.` }) : mk('web.http_protocol', 'not_checked', { reason: 'not reported' }));
  out.push(typeof edge.is_eu === 'boolean' ? mk('web.eu_region', 'found', { value: `${edge.is_eu ? 'You appear to be in the EU' : 'You do not appear to be in the EU'}${edge.continent ? ` (continent ${edge.continent}${edge.region_code ? `, region ${edge.region_code}` : ''})` : ''}. Sites use this to decide which privacy rules apply to you.` }) : mk('web.eu_region', 'not_checked', { reason: 'not reported' }));
  if (typeof edge.now === 'number' && typeof env.nowMs === 'number') {
    const diff = Math.round((env.nowMs - edge.now) / 1000);
    out.push(mk('web.clock_skew', 'found', { value: Math.abs(diff) <= 5 ? 'Your device clock matches ours to within a few seconds.' : `Your device clock is about ${Math.abs(diff)} seconds ${diff > 0 ? 'ahead of' : 'behind'} ours. A clock that is off is itself a small fingerprint.` }));
  } else out.push(mk('web.clock_skew', 'not_checked', { reason: 'no server time to compare' }));
  return out;
}

/** The exact device model from client hints. Browsers that do not offer them (Firefox, Safari) give "not checked", never "clear". */
export async function deviceModel(ua: UaData | null | undefined): Promise<WebExtra> {
  const id = 'web.device_model';
  if (!ua || typeof ua.getHighEntropyValues !== 'function') return mk(id, 'not_checked', { reason: 'this browser does not share device details' });
  try {
    const v = await ua.getHighEntropyValues(['model', 'platformVersion', 'architecture', 'fullVersionList']);
    const parts = [v.model && `model ${String(v.model)}`, ua.platform && `${ua.platform}${v.platformVersion ? ` ${String(v.platformVersion)}` : ''}`, v.architecture && `${String(v.architecture)} processor`].filter(Boolean);
    return parts.length ? mk(id, 'found', { value: `Any site can ask your browser for: ${parts.join(', ')}.` }) : mk(id, 'clear');
  } catch (e) {
    return mk(id, 'not_checked', { reason: `could not read device details: ${String(e).slice(0, 80)}` });
  }
}

export async function collectWebExtras(fetchImpl: typeof fetch = fetch, env: ExtraEnv = {}): Promise<WebExtra[]> {
  let edge: EdgeExtra | null = null;
  try {
    const base = (import.meta.env.VITE_WORKER_ENDPOINT || 'https://api.myprivacytool.io').replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/whoami-extra`, { cache: 'no-store' });
    if (res.ok) edge = (await res.json()) as EdgeExtra;
  } catch { /* edge stays null: every edge hexagon says not checked */ }
  const dev = env.deviceTimeZone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  const ua = env.userAgentData ?? (typeof navigator !== 'undefined' ? ((navigator as unknown as { userAgentData?: UaData }).userAgentData ?? null) : null);
  const list = [...edgeExtras(edge, { deviceTimeZone: dev, nowMs: env.nowMs ?? Date.now() }), await deviceModel(ua)];
  return WEB_EXTRA_IDS.map((id) => list.find((x) => x.id === id)).filter((x): x is WebExtra => Boolean(x));
}

/** Ids whose check ran (found or clear): what the footprint count adds. Not-checked extras never count. */
export const checkedExtraIds = (list: WebExtra[]): string[] => list.filter((x) => x.status !== 'not_checked').map((x) => x.id);
