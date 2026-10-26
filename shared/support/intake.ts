import type { CaseStore, InboundEvent, SupportCase } from "./types";
import { isOpen } from "./states";

export type IntakeResult =
  | { status: "help_only" }
  | { status: "invalid"; reason: string }
  | { status: "unavailable" }
  | { status: "recorded"; case: SupportCase; duplicate: boolean; reopened: boolean; attachedToThread: boolean };

const MAX_TEXT = 8000;
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newCaseRef(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return "SUP-" + [...b].map((x) => B32[x % 32]).join("");
}

// eslint-disable-next-line no-control-regex
const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

/**
 * Durable, deduplicated intake. A case reference is returned ONLY after the store confirms the write. Any store error
 * yields `unavailable`, and the caller must not acknowledge a tracked request. Bare HELP opens create nothing.
 */
export async function receive(store: CaseStore, ev: InboundEvent, policyVersion: string, now: () => Date = () => new Date()): Promise<IntakeResult> {
  if (ev.helpOnly) return { status: "help_only" };
  if (!ev.providerEventId?.trim()) return { status: "invalid", reason: "missing providerEventId" };
  const text = clean(ev.text ?? "");
  if (!text) return { status: "invalid", reason: "empty message" };
  if (text.length > MAX_TEXT) return { status: "invalid", reason: "message too long" };
  const event = { ...ev, text };
  const at = now().toISOString();
  try {
    if (event.threadKey) {
      const existing = await store.findCaseByThread(event.channel, event.threadKey);
      if (existing) {
        const { duplicate } = await store.appendInbound(existing.id, event, at);
        if (duplicate) return { status: "recorded", case: existing, duplicate: true, reopened: false, attachedToThread: true };
        let c = existing;
        let reopened = false;
        if (c.state === "resolved" || !isOpen(c.state)) {
          c = await store.updateCase(c.id, { state: "reopened", stateReason: "customer replied after resolution", reopenCount: c.reopenCount + 1 }, at);
          reopened = true;
        }
        return { status: "recorded", case: c, duplicate: false, reopened, attachedToThread: true };
      }
    }
    const r = await store.createCaseFromEvent(event, { ref: newCaseRef(), policyVersion, now: at });
    return { status: "recorded", case: r.case, duplicate: r.duplicate, reopened: false, attachedToThread: false };
  } catch {
    return { status: "unavailable" };
  }
}
