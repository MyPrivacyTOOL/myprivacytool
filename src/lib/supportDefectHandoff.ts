// MPC-8529: build a SANITISED defect report for the existing authorised engineering workflow.
// This only builds the payload. It sends nothing, creates no ticket, and routes to no person: delivery is the job of the
// engineering workflow (a reviewed task or issue), never an automatic production fix and never the founder by default.
// PROVISIONAL: the real case fields come from MPC-8528; the input here is deliberately small and generic.

export interface DefectInput {
  caseRef: string;                 // opaque reference, not an email or name
  area: "scan" | "report" | "email" | "help" | "billing" | "other";
  summary: string;                 // free text from a diagnostic; may contain personal data and is redacted below
  reproSteps?: string[];
  observed?: string;
  expected?: string;
  occurrences?: number;
  firstSeen?: string;              // ISO timestamp
  lastSeen?: string;               // ISO timestamp
}

export interface DefectHandoff {
  version: 1;
  caseRef: string;
  area: DefectInput["area"];
  title: string;
  summary: string;
  reproSteps: string[];
  observed: string;
  expected: string;
  occurrences: number;
  firstSeen: string | null;
  lastSeen: string | null;
  redactions: number;              // how many items were removed, so a reviewer knows the text was altered
  routing: "engineering_review";   // the only route; there is no field for a person or for production changes
  autoFixAllowed: false;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_WITH_QUERY = /\bhttps?:\/\/[^\s?#]+(?:\?[^\s#]*)?(?:#\S*)?/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;                  // report tokens, API keys, session ids
const KEYED_SECRET = /\b(token|secret|password|passwd|apikey|api_key|authorization|bearer|cookie|session)\b\s*[:=]?\s*\S+/gi;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

const MAX_FIELD = 600;
const MAX_STEPS = 12;

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  const swap = (re: RegExp, label: string) => {
    text = text.replace(re, () => { count += 1; return label; });
  };
  // Order matters: strip keyed secrets and URLs first so their tails are not half-matched by later patterns.
  swap(KEYED_SECRET, "[secret]");
  swap(URL_WITH_QUERY, "[url]");
  swap(EMAIL, "[email]");
  swap(IPV4, "[ip]");
  swap(PHONE, "[phone]");
  swap(LONG_TOKEN, "[token]");
  return { text: text.length > MAX_FIELD ? text.slice(0, MAX_FIELD) + "..." : text, count };
}

export function buildDefectHandoff(input: DefectInput): DefectHandoff {
  let redactions = 0;
  const clean = (s: string | undefined) => {
    const r = redact(s ?? "");
    redactions += r.count;
    return r.text;
  };
  const summary = clean(input.summary);
  const steps = (input.reproSteps ?? []).slice(0, MAX_STEPS).map(clean);
  const observed = clean(input.observed);
  const expected = clean(input.expected);
  const ref = redact(input.caseRef);
  redactions += ref.count;
  return {
    version: 1,
    caseRef: ref.count ? "[redacted-ref]" : input.caseRef.slice(0, 64),
    area: input.area,
    title: `[support:${input.area}] ${summary.split("\n")[0].slice(0, 100)}`,
    summary,
    reproSteps: steps,
    observed,
    expected,
    occurrences: Math.max(1, Math.floor(input.occurrences ?? 1)),
    firstSeen: input.firstSeen ?? null,
    lastSeen: input.lastSeen ?? null,
    redactions,
    routing: "engineering_review",
    autoFixAllowed: false,
  };
}
