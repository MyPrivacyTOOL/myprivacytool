// MPC-8528: shared AI support service scaffold. Contracts only; nothing here is wired to a channel, a model provider
// or the live database. See docs/support-ai-backend-mpc-8528.md.

export const CASE_STATES = [
  "new", "triage", "diagnosing", "action_running", "waiting_customer", "waiting_system",
  "resolved", "closed", "reopened", "blocked",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

/** Channels that may call the service. Enabling a channel is MPC-8532's job; the service only names them. */
export type Channel = "web" | "email" | "telegram" | "whatsapp" | "sms" | "social" | "voice";

/**
 * Identity levels. A platform sender id or a yes/no reply is only `channel_asserted`. Only a Verifier result
 * (one-time proof delivered out of band, session token, etc.) can yield `verified`.
 */
export type IdentityLevel = "anonymous" | "channel_asserted" | "verified";
export interface Identity { level: IdentityLevel; subjectId?: string; tenantId?: string }

/** Normalised inbound event: the one shape MPC-8527 (website HELP) and MPC-8532 (channel adapters) must produce. */
export interface InboundEvent {
  channel: Channel;
  /** Provider event/message id. Required: it is the dedupe key. Adapters must authenticate the provider before this. */
  providerEventId: string;
  /** Provider thread/conversation id or email Message-ID chain root; enables reply continuity. */
  threadKey?: string;
  /** Opaque sender handle on that channel (never used as authentication). */
  senderHandle?: string;
  text: string;
  locale?: string;
  receivedAt: string;
  /** Minimal journey reference, e.g. route name. No personal data, no report tokens. */
  journeyRef?: string;
  /** True when the event is a bare HELP/menu open with no question. It creates no case and triggers no action. */
  helpOnly?: boolean;
}

export interface SupportCase {
  id: string;
  /** Customer-facing reference, e.g. SUP-7K2Q9XMD. */
  ref: string;
  channel: Channel;
  threadKey?: string;
  senderHandle?: string;
  state: CaseState;
  /** Reason shown when state is waiting_system / blocked. Never implies a human is looking. */
  stateReason?: string;
  identityLevel: IdentityLevel;
  /** Set only after verification. */
  linkedSubjectId?: string;
  tenantId?: string;
  policyVersion: string;
  knowledgeVersion?: string;
  createdAt: string;
  updatedAt: string;
  reopenCount: number;
}

export interface CaseMessage {
  id: string;
  caseId: string;
  direction: "inbound" | "outbound";
  providerEventId?: string;
  text: string;
  author: "customer" | "ai" | "system";
  at: string;
  delivery?: DeliveryStatus;
}
export type DeliveryStatus = "queued" | "sent" | "failed" | "unknown";

export interface ActionReceipt {
  id: string;
  caseId: string;
  tool: string;
  idempotencyKey: string;
  policyVersion: string;
  outcome: "success" | "denied" | "failed" | "unknown" | "rate_limited" | "disabled";
  /** `unknown` = the tool timed out or crashed after it may have written. Never reported to the customer as success. */
  detail?: string;
  costUnits: number;
  at: string;
}

/** Persistence port. The real implementation is Postgres via the support_* tables; tests use an in-memory fake. */
export interface CaseStore {
  /** Atomic: insert case+first message unless (channel, providerEventId) exists. Throws if not durably stored. */
  createCaseFromEvent(ev: InboundEvent, init: { ref: string; policyVersion: string; now: string }):
    Promise<{ case: SupportCase; duplicate: boolean }>;
  findCaseByThread(channel: Channel, threadKey: string): Promise<SupportCase | null>;
  /** Includes resolved and closed cases, so a late reply reopens rather than forks. */
  /** Atomic: append the message unless (caseId, providerEventId) exists. */
  appendInbound(caseId: string, ev: InboundEvent, now: string): Promise<{ duplicate: boolean }>;
  getCase(id: string): Promise<SupportCase | null>;
  getCaseByRef(ref: string): Promise<SupportCase | null>;
  updateCase(id: string, patch: Partial<Pick<SupportCase, "state" | "stateReason" | "identityLevel" | "linkedSubjectId" | "tenantId" | "knowledgeVersion" | "reopenCount">>, now: string): Promise<SupportCase>;
  addOutbound(caseId: string, text: string, author: "ai" | "system", now: string): Promise<CaseMessage>;
  setDelivery(messageId: string, status: DeliveryStatus, now: string): Promise<void>;
  getReceipt(caseId: string, idempotencyKey: string): Promise<ActionReceipt | null>;
  /** Upsert by (caseId, idempotencyKey). */
  putReceipt(r: Omit<ActionReceipt, "id">): Promise<ActionReceipt>;
  /** Cost/rate accounting window; returns the sum of costUnits for the subject-or-case key since `sinceIso`. */
  usageSince(key: string, sinceIso: string): Promise<{ calls: number; costUnits: number }>;
  recordUsage(key: string, costUnits: number, at: string): Promise<void>;
}

export interface KnowledgeEntry {
  id: string;
  version: string;
  /** Only `approved` entries are ever retrieved. Approval is recorded by the knowledge owner (MPC-8530/7560/7561). */
  status: "draft" | "approved" | "retired";
  approvedBy?: string;
  title: string;
  body: string;
  scope: string[];
}
export interface KnowledgeSource { search(query: string, locale?: string): Promise<KnowledgeEntry[]> }

export interface ModelRequest { system: string; caseText: string; knowledge: { id: string; version: string; body: string }[]; allowedTools: string[] }
export interface ModelResponse { text: string; toolCalls?: { tool: string; args: Record<string, unknown> }[]; /** Actual cost of the call in micro-USD when the provider reports it; used only to record spend above the reserved estimate. */ costMicroUsd?: number }
export interface Model { complete(req: ModelRequest): Promise<ModelResponse> }

/** Throw on any failed or unconfirmed send: the service records the reply as undelivered. `to` is the address/handle that sent the inbound message, never one found in message text. */
export interface Notifier { send(caseRef: string, channel: Channel, text: string, threadKey?: string, to?: string): Promise<{ providerMessageId: string }> }

export interface Verifier {
  /** Resolve a proof (session token, one-time code check done out of band) to an Identity. Unknown proof => anonymous. */
  resolve(proof: string | undefined, channel: Channel, senderHandle?: string): Promise<Identity>;
}
