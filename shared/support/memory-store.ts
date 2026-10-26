import type { ActionReceipt, CaseMessage, CaseStore, Channel, DeliveryStatus, InboundEvent, SupportCase } from "./types";

/**
 * In-memory CaseStore for isolated tests ONLY. Fault injection lets tests prove failure paths against stored state.
 * It is not a production store and must never be imported by deployed code.
 */
export class MemoryCaseStore implements CaseStore {
  cases = new Map<string, SupportCase>();
  messages: CaseMessage[] = [];
  receipts = new Map<string, ActionReceipt>();
  usage: { key: string; costUnits: number; at: string }[] = [];
  /** Method names that throw before doing anything. */
  failBefore = new Set<string>();
  /** Methods that perform the write and then throw (the "timeout after a successful write" case). */
  failAfterWrite = new Set<string>();
  private n = 0;
  private id = (p: string) => `${p}-${++this.n}`;
  private chk(m: string) { if (this.failBefore.has(m)) throw new Error(`injected failure: ${m}`); }
  private post(m: string) { if (this.failAfterWrite.has(m)) throw new Error(`injected timeout after write: ${m}`); }

  async createCaseFromEvent(ev: InboundEvent, init: { ref: string; policyVersion: string; now: string }) {
    this.chk("createCaseFromEvent");
    const dup = this.messages.find((m) => m.direction === "inbound" && m.providerEventId === ev.providerEventId && this.cases.get(m.caseId)?.channel === ev.channel);
    if (dup) return { case: this.cases.get(dup.caseId)!, duplicate: true };
    const c: SupportCase = {
      id: this.id("case"), ref: init.ref, channel: ev.channel, threadKey: ev.threadKey, senderHandle: ev.senderHandle, state: "new",
      identityLevel: ev.senderHandle ? "channel_asserted" : "anonymous", policyVersion: init.policyVersion,
      createdAt: init.now, updatedAt: init.now, reopenCount: 0,
    };
    this.cases.set(c.id, c);
    this.messages.push({ id: this.id("msg"), caseId: c.id, direction: "inbound", providerEventId: ev.providerEventId, text: ev.text, author: "customer", at: init.now });
    this.post("createCaseFromEvent");
    return { case: c, duplicate: false };
  }
  async findCaseByThread(channel: Channel, threadKey: string) {
    this.chk("findCaseByThread");
    return [...this.cases.values()].find((c) => c.channel === channel && c.threadKey === threadKey) ?? null;
  }
  async appendInbound(caseId: string, ev: InboundEvent, now: string) {
    this.chk("appendInbound");
    if (this.messages.some((m) => m.caseId === caseId && m.direction === "inbound" && m.providerEventId === ev.providerEventId)) return { duplicate: true };
    this.messages.push({ id: this.id("msg"), caseId, direction: "inbound", providerEventId: ev.providerEventId, text: ev.text, author: "customer", at: now });
    this.post("appendInbound");
    return { duplicate: false };
  }
  async getCase(id: string) { this.chk("getCase"); return this.cases.get(id) ?? null; }
  async getCaseByRef(ref: string) { return [...this.cases.values()].find((c) => c.ref === ref) ?? null; }
  async updateCase(id: string, patch: Parameters<CaseStore["updateCase"]>[1], now: string) {
    this.chk("updateCase");
    const c = this.cases.get(id); if (!c) throw new Error("no such case");
    const next = { ...c, ...patch, updatedAt: now }; this.cases.set(id, next); return next;
  }
  async addOutbound(caseId: string, text: string, author: "ai" | "system", now: string) {
    this.chk("addOutbound");
    const m: CaseMessage = { id: this.id("msg"), caseId, direction: "outbound", text, author, at: now, delivery: "queued" };
    this.messages.push(m); return m;
  }
  async setDelivery(messageId: string, status: DeliveryStatus) {
    this.chk("setDelivery");
    const m = this.messages.find((x) => x.id === messageId); if (m) m.delivery = status;
  }
  async getReceipt(caseId: string, key: string) { this.chk("getReceipt"); return this.receipts.get(`${caseId}|${key}`) ?? null; }
  async putReceipt(r: Omit<ActionReceipt, "id">) {
    this.chk("putReceipt");
    const k = `${r.caseId}|${r.idempotencyKey}`;
    const rec = { ...r, id: this.receipts.get(k)?.id ?? this.id("rcpt") }; this.receipts.set(k, rec); return rec;
  }
  async usageSince(key: string, sinceIso: string) {
    const u = this.usage.filter((x) => x.key === key && x.at >= sinceIso);
    return { calls: u.length, costUnits: u.reduce((a, b) => a + b.costUnits, 0) };
  }
  async recordUsage(key: string, costUnits: number, at: string) { this.usage.push({ key, costUnits, at }); }
}
