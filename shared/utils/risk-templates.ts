// MPC-8302: the "Mirror". Reflects the lookup back to the user and maps every finding to a localization key
// from public.localization (MPT-1003, keys under `risk.*`, seed: supabase/sql/mpt_8302_risk_localization_seed_en.sql).
// No sentence is hard-coded here: callers pass a key->string map for the user's locale and we only interpolate.

import type { RiskSummary } from "./osint-lookup";

export type Strings = Record<string, string>;

export interface MirrorMessage {
  /** Ordered keys with their params: the machine-readable form (store/translate/re-render later). */
  parts: Array<{ key: string; params?: Record<string, string | number> }>;
  /** Fully rendered text for the requested locale. */
  text: string;
  /** Keys that were missing from `strings` and fell back to `fallback` (or were omitted). Log these. */
  missing_keys: string[];
}

const interpolate = (tpl: string, params: Record<string, string | number> = {}) =>
  tpl.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
}

/** Map findings -> ordered localization keys + params (pure; no strings). */
export function buildMirrorParts(s: RiskSummary): MirrorMessage["parts"] {
  const parts: MirrorMessage["parts"] = [
    { key: `risk.summary.${s.risk_level}.title` },
    { key: "risk.mirror.header", params: { input: s.input_type === "email" ? maskEmail(s.input_value) : s.input_value } },
  ];
  if (s.status === "checked") {
    parts.push({ key: s.breach_count === 1 ? "risk.mirror.breaches_one" : "risk.mirror.breaches_other", params: { count: s.breach_count ?? 0 } });
    if (s.paste_count) parts.push({ key: s.paste_count === 1 ? "risk.mirror.pastes_one" : "risk.mirror.pastes_other", params: { count: s.paste_count } });
    if (s.breach_list.length) {
      parts.push({ key: "risk.mirror.breach_names", params: { names: s.breach_list.slice(0, 3).map((b) => b.name).join(", ") } });
      const classes = [...new Set(s.breach_list.flatMap((b) => b.data_classes))].slice(0, 5);
      if (classes.length) parts.push({ key: "risk.mirror.data_classes", params: { classes: classes.join(", ") } });
    }
    parts.push({ key: "risk.mirror.score", params: { score: s.exposure_score ?? 0 } });
    if (s.confidence === "medium") parts.push({ key: "risk.mirror.partial" });
  } else {
    parts.push({ key: "risk.mirror.not_checked", params: { reason: s.reason ?? "" } });
  }
  parts.push({ key: `risk.summary.${s.risk_level}.body` }, { key: "risk.next.title" });
  for (const k of s.next_steps) parts.push({ key: k });
  return parts;
}

/** Render with the user's locale strings; `fallback` (usually en) fills any key the locale does not have yet. */
export function renderMirror(s: RiskSummary, strings: Strings, fallback: Strings = {}): MirrorMessage {
  const parts = buildMirrorParts(s);
  const missing: string[] = [];
  const lines: string[] = [];
  for (const p of parts) {
    const tpl = strings[p.key] || fallback[p.key];       // empty string = untranslated placeholder
    if (!tpl) { missing.push(p.key); continue; }
    if (!strings[p.key]) missing.push(p.key);
    const line = interpolate(tpl, p.params);
    lines.push(p.key.startsWith("risk.next.") && p.key !== "risk.next.title" ? `• ${line}` : line);
  }
  return { parts, text: lines.join("\n"), missing_keys: missing };
}
