import type { Channel, Notifier } from "./types";

export interface ResendNotifierConfig { apiKey: string; from: string; fetchImpl?: typeof fetch; timeoutMs?: number }

const EMAIL = /^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,255}$/;
const h = (s: string): string => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };

/**
 * Email reply over Resend (same API contract as workers/scan-report/lib/email.js). It only ever answers the address that
 * sent the inbound message (`to`), threads with In-Reply-To/References, and THROWS unless Resend confirms (2xx with an id),
 * so an unconfirmed send is recorded as undelivered, never as contact made. It never sends marketing and never reads an
 * address from message text.
 */
export class ResendNotifier implements Notifier {
  constructor(private c: ResendNotifierConfig) { if (!c.apiKey || !c.from) throw new Error("apiKey and from required"); }
  async send(caseRef: string, channel: Channel, text: string, threadKey?: string, to?: string) {
    if (channel !== "email") throw new Error("ResendNotifier only sends email");
    if (!to || !EMAIL.test(to)) throw new Error("no valid reply address");
    const res = await (this.c.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.c.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `support-${caseRef}-${h(text)}` },
      body: JSON.stringify({ from: this.c.from, to: [to], subject: `Re: [${caseRef}] your request`, text, headers: threadKey ? { "In-Reply-To": threadKey, References: threadKey } : undefined }),
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    if (!j.id) throw new Error("Resend did not confirm the send");
    return { providerMessageId: j.id };
  }
}

/**
 * Web has no outbound push: the reply travels in the HTTP response to the request that carried the message. This resolves
 * without sending anything, so `delivered` means only "the reply is in the response", not that the visitor read it.
 */
export class InBandNotifier implements Notifier {
  async send(caseRef: string, channel: Channel) { if (channel !== "web") throw new Error("InBandNotifier only serves web"); return { providerMessageId: `inband:${caseRef}` }; }
}

/** Routes by channel; any channel without a notifier throws, so an unsupported channel is "undelivered", never silently dropped or redirected. */
export class ChannelNotifier implements Notifier {
  constructor(private by: Partial<Record<Channel, Notifier>>) {}
  async send(caseRef: string, channel: Channel, text: string, threadKey?: string, to?: string) {
    const n = this.by[channel];
    if (!n) throw new Error(`no notifier for channel ${channel}`);
    return n.send(caseRef, channel, text, threadKey, to);
  }
}
