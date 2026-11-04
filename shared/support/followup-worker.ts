import type { CaseState, CaseStore, Channel, Notifier, SupportCase } from "./types";

// MPC-8529: the follow-up worker. It claims due cases from the watchdog tables (supabase/proposed/mpc_8529_support_followup.sql),
// sends ONE fixed, honest message per due action through the MPC-8528 Notifier port, and records the outcome. It decides nothing
// about policy: it never resolves a case, never calls a tool, never sends marketing, never promises a human or a response time.
// NOT scheduled and NOT deployed: nothing runs this until the sweep/worker is approved and wired (MPC-8532 supplies Notifiers).

export interface DueFollowup {
  caseId: string;
  nextActionKind: string | null;
  attemptCount: number;
  maxAttempts: number;
}

/** Port over the SQL functions. `RestFollowupStore` is the PostgREST implementation; tests use a fake. */
export interface FollowupStore {
  claimDue(owner: string, limit: number, leaseSeconds: number): Promise<DueFollowup[]>;
  recordAttempt(caseId: string, key: string, kind: string, outcome: "attempted" | "delivered" | "failed", receipt: string | null, messageId: string | null): Promise<"recorded" | "duplicate" | "terminal">;
  markDelivered(key: string, receipt: string): Promise<boolean>;
  /** True if this kind was already sent (provider accepted) with no receipt since `sinceIso`, so a re-check never sends it twice. Older ones do not block a reopened case. */
  hasUnconfirmedAttempt(caseId: string, kind: string, sinceIso: string): Promise<boolean>;
}

/** Fixed text. No AI claims, no promise of a human, no response time, no outcome. */
export const FOLLOWUP_TEXT: Record<string, (ref: string) => string> = {
  update: (ref) => `This is an automated update on ${ref}. It is still open and unresolved. Nothing has been changed on your account. You can reply here to add information.`,
  first_response: (ref) => `This is an automated message about ${ref}. Your request is saved and still open. We cannot promise that it will be resolved, or when.`,
  respond: (ref) => `This is an automated message about ${ref}. We received your reply and your request is still open and unresolved.`,
  diagnose: (ref) => `This is an automated update on ${ref}. The earlier check did not confirm a fix, so the request is open again. Nothing has been changed on your account.`,
};

const TERMINAL: readonly CaseState[] = ["resolved", "closed", "blocked"];
const UNCONFIRMED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface FollowupDeps {
  store: FollowupStore;
  cases: Pick<CaseStore, "getCase" | "addOutbound" | "setDelivery">;
  notifier: Notifier;
  owner: string;
  now: () => string;
  limit?: number;
  leaseSeconds?: number;
}

export interface CycleReport {
  claimed: number; sent: number; failed: number; skipped: number; rechecked: number; terminal: number;
  /** Counts only: no case references, addresses or message text. */
  errors: string[];
}

/**
 * One bounded cycle. Idempotency key per send is `${caseId}:${kind}:${n}` where n = attempts already made, so a crash between
 * the provider call and the record cannot create a second, different attempt row for the same step.
 * A provider acceptance is recorded as 'attempted', never 'delivered': only a receipt (markDelivered) proves delivery. A re-check
 * of an unconfirmed attempt sends NOTHING new; it records a bounded 'failed' step, so a channel with no receipts ends honestly
 * as blocked / followup_exhausted instead of re-sending forever.
 */
export async function runFollowupCycle(d: FollowupDeps): Promise<CycleReport> {
  const r: CycleReport = { claimed: 0, sent: 0, failed: 0, skipped: 0, rechecked: 0, terminal: 0, errors: [] };
  const due = await d.store.claimDue(d.owner, d.limit ?? 10, d.leaseSeconds ?? 300);
  r.claimed = due.length;
  for (const item of due) {
    const kind = item.nextActionKind ?? "respond";
    const key = `${item.caseId}:${kind}:${item.attemptCount + 1}`;
    try {
      const c: SupportCase | null = await d.cases.getCase(item.caseId);
      if (!c || TERMINAL.includes(c.state)) { r.terminal += 1; continue; }
      const text = FOLLOWUP_TEXT[kind];
      if (!text) { r.skipped += 1; continue; }              // an action kind this worker does not own (e.g. verify_resolution)
      const since = new Date(Date.parse(d.now()) - UNCONFIRMED_WINDOW_MS).toISOString();
      if (await d.store.hasUnconfirmedAttempt(item.caseId, kind, since)) {
        await d.store.recordAttempt(item.caseId, `${key}:recheck`, kind, "failed", null, null);
        r.rechecked += 1;
        continue;
      }
      const msg = await d.cases.addOutbound(item.caseId, text(c.ref), "system", d.now());   // write-ahead, delivery = queued
      try {
        const sent = await d.notifier.send(c.ref, c.channel as Channel, msg.text, c.threadKey, c.senderHandle);
        await d.store.recordAttempt(item.caseId, key, kind, "attempted", sent.providerMessageId, msg.id);
        r.sent += 1;
      } catch (e) {
        await d.store.recordAttempt(item.caseId, key, kind, "failed", null, msg.id);
        r.failed += 1;
        r.errors.push(`send:${(e as Error).name}`);
      }
    } catch (e) {
      // Store or lookup failure: leave the lease to expire so the case is retried; never claim success.
      r.errors.push(`cycle:${(e as Error).name}`);
    }
  }
  return r;
}

/** A provider delivery receipt (webhook) for an earlier send. Only this marks it delivered. */
export async function applyDeliveryReceipt(store: FollowupStore, attemptKey: string, receiptRef: string): Promise<boolean> {
  return store.markDelivered(attemptKey, receiptRef);
}
