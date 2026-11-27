// MPC-11111: three server-side GA4 flow events, sent with the Measurement Protocol. Built SWITCHED OFF.
//
//   dm_received       a message arrived at core-brain (params: channel)
//   email_confirmed   the person pressed the confirm button in the email link (params: none)
//   report_delivered  the mail provider reported the report email as delivered (params: none)
//
// Off by default, three independent gates, all of which must hold:
//   1. the registry entry `ga4-measurement-protocol` is enabled (shared/recipients/recipients.json; it ships enabled:false)
//   2. env.GA4_SERVER_EVENTS_ENABLED is the exact string "true"
//   3. env.GA4_API_SECRET is set (a Worker secret; only Chris creates it)
// With any gate closed this sends nothing and makes no network call.
//
// Privacy: an event carries its name, the channel for dm_received, and a random anonymous client id. Never an email address, handle,
// message text, IP address, scan id or scan result. The client id is a SHA-256 of an internal id plus a fixed label, truncated: it is
// stable for one scan (so the stages of one flow can be matched in GA4) and cannot be reversed to the scan or the person.
// A failure here never changes the work it describes: this function never throws.
import { callRecipient } from "./recipients/outbound.ts";
import type { RecipientContext } from "./recipients/outbound.ts";

export const GA4_SERVER_EVENT_NAMES = ["dm_received", "email_confirmed", "report_delivered"] as const;
export type Ga4ServerEvent = (typeof GA4_SERVER_EVENT_NAMES)[number];

// Same property as the browser tag (docs/GA4-AUDIT.md). A staging stream can be used instead by setting env.GA4_MEASUREMENT_ID.
export const DEFAULT_MEASUREMENT_ID = "G-1BWMDBJSPL";

export interface Ga4ServerEnv {
  GA4_SERVER_EVENTS_ENABLED?: string;
  GA4_API_SECRET?: string;
  GA4_MEASUREMENT_ID?: string;
  GA4_DEBUG_MODE?: string;
}

/** True only when the env switch is exactly "true" and the secret is present. The registry gate is checked by callRecipient. */
export const ga4ServerEventsOn = (env: Ga4ServerEnv): boolean => env.GA4_SERVER_EVENTS_ENABLED === "true" && !!env.GA4_API_SECRET;

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Anonymous, stable-per-flow client id: 32 hex chars of SHA-256(label + ":" + internalId). Without an id, a random one. */
export async function anonymousClientId(internalId?: string): Promise<string> {
  if (!internalId) return hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mpt-ga4-flow:${internalId}`))).slice(0, 32);
}

export interface SendOptions {
  /** Internal id the client id is derived from (a scan id). Omit for a random id. */
  flowId?: string;
  /** Allowed params per event, see PARAMS below. */
  params?: Record<string, string>;
  /** The Worker's recipient context (workerRecipientContext(env)). */
  rctx?: RecipientContext;
}

// The only params an event may carry. Anything else is dropped, so a caller cannot send a value by accident.
const PARAMS: Record<Ga4ServerEvent, readonly string[]> = { dm_received: ["channel"], email_confirmed: [], report_delivered: [] };
const CHANNEL = /^[a-z0-9_]{1,24}$/;

/** Sends one event when every gate is open. Resolves to true when GA4 accepted it, false otherwise (including every closed gate). Never throws. */
export async function sendGa4ServerEvent(env: Ga4ServerEnv, name: Ga4ServerEvent, opts: SendOptions = {}): Promise<boolean> {
  try {
    if (!ga4ServerEventsOn(env) || !GA4_SERVER_EVENT_NAMES.includes(name)) return false;
    const params: Record<string, string | number> = {};
    for (const k of PARAMS[name]) {
      const v = opts.params?.[k];
      if (typeof v === "string" && CHANNEL.test(v)) params[k] = v;
    }
    if (env.GA4_DEBUG_MODE === "true") params.debug_mode = 1;   // shows the event in GA4 DebugView on a staging stream
    const id = (env.GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID).trim();
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET as string)}`;
    const body = JSON.stringify({ client_id: await anonymousClientId(opts.flowId), events: [{ name, params }] });
    // sent: [] because the body carries no registry data item (see the privacy note above).
    const res = await callRecipient("ga4-measurement-protocol", { url, init: { method: "POST", headers: { "content-type": "application/json" }, body }, sent: [] }, opts.rctx ?? {});
    return res.ok;
  } catch {
    return false;   // a closed registry gate (DISABLED), a network error, anything: GA4 events never break the flow
  }
}
