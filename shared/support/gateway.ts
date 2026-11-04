import type { ActionReceipt, CaseStore, Identity, SupportCase } from "./types";
import { meets } from "./identity";
import type { SupportPolicy } from "./policy";

export interface ToolDef {
  name: string;
  sideEffect: "read" | "write";
  costUnits: number;
  /** Runs with an injected subject. Args never carry the subject: the gateway strips and rejects it. */
  run(ctx: { caseId: string; subjectId?: string; tenantId?: string }, args: Record<string, unknown>): Promise<{ ok: boolean; detail: string }>;
}
export interface ToolOutcome { receipt: ActionReceipt; replayed: boolean }

const FORBIDDEN_ARGS = ["subjectId", "tenantId", "userId", "accountId", "email"];

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));

/**
 * Tool gateway. Every decision here is made from policy + verified identity + stored state, never from model text.
 * Every call, including denied and disabled ones, leaves a receipt.
 */
export class ToolGateway {
  constructor(private store: CaseStore, private policy: SupportPolicy, private tools: Record<string, ToolDef>, private now: () => Date = () => new Date()) {}

  /** Tools the model may even be told about for this identity (still re-checked on execution). */
  allowedFor(identity: Identity): string[] {
    return Object.keys(this.tools).filter((n) => {
      const p = this.policy.tools[n];
      return !!p && !!p.approvedPolicyVersion && meets(identity, p.requiredIdentity);
    });
  }

  async execute(c: SupportCase, identity: Identity, tool: string, args: Record<string, unknown>, idempotencyKey?: string): Promise<ToolOutcome> {
    const at = this.now().toISOString();
    // The key is bound to the caller's subject, so one identity can never be served another identity's stored receipt.
    const key = await sha(`${c.id}|${identity.subjectId ?? identity.level}|${tool}|${idempotencyKey ?? canon(args)}`);
    const prior = await this.store.getReceipt(c.id, key);
    // A replayed request returns the stored outcome. It never re-runs the tool, including after `unknown`.
    if (prior) return { receipt: prior, replayed: true };

    const rec = async (outcome: ActionReceipt["outcome"], detail: string, costUnits = 0) =>
      this.store.putReceipt({ caseId: c.id, tool, idempotencyKey: key, policyVersion: this.policy.version, outcome, detail, costUnits, at });

    const def = this.tools[tool];
    const pol = this.policy.tools[tool];
    if (!def || !pol) return { receipt: await rec("denied", "unknown tool"), replayed: false };
    if (!pol.approvedPolicyVersion) return { receipt: await rec("disabled", "no approved policy for this tool"), replayed: false };
    if (!meets(identity, pol.requiredIdentity)) return { receipt: await rec("denied", `requires ${pol.requiredIdentity} identity`), replayed: false };
    if (pol.requiredIdentity === "verified") {
      // The case must be linked to this same verified subject and tenant; a different verified user is a wrong-user request.
      if (!identity.subjectId || c.linkedSubjectId !== identity.subjectId || c.tenantId !== identity.tenantId)
        return { receipt: await rec("denied", "identity does not match case"), replayed: false };
    }
    if (FORBIDDEN_ARGS.some((k) => k in args)) return { receipt: await rec("denied", "subject/tenant cannot be supplied as an argument"), replayed: false };

    const usageKey = `${tool}:${identity.subjectId ?? c.id}`;
    const hour = await this.store.usageSince(usageKey, new Date(this.now().getTime() - 3_600_000).toISOString());
    const day = await this.store.usageSince(usageKey, new Date(this.now().getTime() - 86_400_000).toISOString());
    if (hour.calls >= pol.maxCallsPerHour || day.costUnits + def.costUnits > pol.maxCostUnitsPerDay)
      return { receipt: await rec("rate_limited", "rate or cost cap reached"), replayed: false };

    // Write-ahead marker for side-effecting tools: if we crash or time out after the write, the stored state is `unknown`.
    if (def.sideEffect === "write") await rec("unknown", "started");
    await this.store.recordUsage(usageKey, def.costUnits, at);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        def.run({ caseId: c.id, subjectId: identity.subjectId, tenantId: identity.tenantId }, args),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), pol.timeoutMs); }),
      ]);
      return { receipt: await rec(res.ok ? "success" : "failed", res.detail, def.costUnits), replayed: false };
    } catch (e) {
      const outcome = def.sideEffect === "write" ? "unknown" : "failed";
      return { receipt: await rec(outcome, (e as Error).message, def.costUnits), replayed: false };
    } finally { if (timer) clearTimeout(timer); }
  }
}
