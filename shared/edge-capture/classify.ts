// MPC-7490: apply the rule list. Pure function, no I/O.
import { ERROR_RULE, FALLBACK_RULE, RULES, RULESET_VERSION, type RequestFacts, type VisitClass } from "./ruleset";

export interface Classification {
  cls: VisitClass;
  rule: string;
  rulesetVersion: string;
}

export function classify(facts: RequestFacts): Classification {
  try {
    for (const r of RULES) {
      if (r.test(facts)) return { cls: r.cls, rule: r.id, rulesetVersion: RULESET_VERSION };
    }
    return { cls: FALLBACK_RULE.cls, rule: FALLBACK_RULE.id, rulesetVersion: RULESET_VERSION };
  } catch {
    return { cls: ERROR_RULE.cls, rule: ERROR_RULE.id, rulesetVersion: RULESET_VERSION };
  }
}

/** An unclassified visit is handled as a person: the safe side (strategy 4.1). */
export const treatAsPerson = (cls: VisitClass): boolean => cls === "person" || cls === "unknown";
