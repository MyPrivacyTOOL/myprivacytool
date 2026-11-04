// Subrequest budget (MPC-9168). A Cloudflare Worker invocation may make a limited number of outbound calls: 50 on the
// Free plan (1000 on Paid). Counted per invocation, and every fetch() counts, including retries and Slack/Notion/Supabase calls.
//
// Since 2026-10-27 one scheduled run made more than 50 calls and every step failed with "Too many subrequests by single Worker
// invocation". The work is now split into phases (worker.js PHASES). Each phase runs as its own invocation (a service-binding call
// to this same Worker), which has its own budget, and no phase may exceed INVOCATION_BUDGET calls. This module counts the calls
// of one phase and refuses the call that would go over, so a runaway loop becomes a clear error row instead of a platform error
// that takes the whole run (including the database write and the alerts) down with it.
export const PLATFORM_LIMIT = 50;      // Workers Free plan, per invocation
export const INVOCATION_BUDGET = 44;   // what one phase may use; the rest is headroom for retries we did not predict
export const RESERVED_FOR_WRITE = 6;   // kept back from collectors for the one database insert and the Slack alerts that follow them

export class SubrequestBudgetError extends Error {
  constructor(label, limit) { super(`subrequest budget exceeded in ${label}: more than ${limit} outbound calls in one invocation`); this.name = 'SubrequestBudgetError'; }
}

// Runs fn with globalThis.fetch replaced by a counting wrapper, then restores it. Phases run one after another per invocation,
// so a single module-level scope is enough. `ceiling()` lets a caller temporarily lower the limit (collectors leave room for the write).
export async function withSubrequestBudget(label, limit, fn) {
  const original = globalThis.fetch;
  const scope = { label, limit, used: 0 };
  globalThis.fetch = function countedFetch(...args) {
    if (scope.used >= scope.limit) return Promise.reject(new SubrequestBudgetError(scope.label, scope.limit));
    scope.used += 1;
    return original.apply(this, args);
  };
  try { return { value: await fn(scope), used: scope.used }; }
  finally { globalThis.fetch = original; }
}
