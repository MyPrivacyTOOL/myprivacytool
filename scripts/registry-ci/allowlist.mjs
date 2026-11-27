// MPC-9884: the allowlist. Every existing finding is recorded here with a note naming the task that removes it (MPC-9885 server side, MPC-9886
// browser side, MPC-9888 the two pre-click STUN findings that the consent UI removes). It is a RATCHET, not an exemption list:
//   - a finding with no matching entry fails (new violation);
//   - an entry that matches nothing fails (the call site is gone: delete the line, that is the point of MPC-9885/9886);
//   - an entry older than 14 days fails (hygiene rule), so the list cannot become permanent.
// Matching ignores line numbers (they drift); an entry is consumed by one finding with the same (rule, file, detail).
export const MAX_AGE_DAYS = 14;
const key = (x) => `${x.rule}\u0000${x.file}\u0000${x.detail}`;

export function validateAllowlist(list) {
  const errs = [];
  if (!list || typeof list !== "object" || list.schema_version !== 1 || !Array.isArray(list.entries)) return ["allowlist must be {schema_version: 1, entries: []}"];
  list.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    for (const f of ["rule", "file", "detail", "added", "note"]) if (typeof e[f] !== "string" || !e[f]) errs.push(`${at}: ${f} is required`);
    if (typeof e.added === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(e.added)) errs.push(`${at}: added must be YYYY-MM-DD`);
    if (typeof e.note === "string" && !/^pending MPC-(9885|9886|9888)\b/.test(e.note)) errs.push(`${at}: note must start with "pending MPC-9885", "pending MPC-9886" or "pending MPC-9888"`);
  });
  return errs;
}

/** Which task owns a finding: browser-side code (src/, index.html, public/, crawl) is MPC-9886; Workers, Functions and shared server code is MPC-9885. */
export function ownerTask(f) {
  return /^(src\/|index\.html|public\/|\(crawl\))/.test(f.file) ? "MPC-9886" : "MPC-9885";
}

export const entryAgeDays = (entry, today) => Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(entry.added + "T00:00:00Z")) / 86_400_000);

/**
 * Split findings into {allowed, violations} and report stale or expired entries.
 * @returns {{violations: object[], allowed: object[], stale: object[], expired: object[], problems: string[]}}
 */
export function applyAllowlist(findings, list, today) {
  const problems = validateAllowlist(list);
  const pool = new Map();
  for (const e of list?.entries ?? []) { const k = key(e); (pool.get(k) ?? pool.set(k, []).get(k)).push(e); }
  const violations = [];
  const allowed = [];
  for (const f of findings) {
    const bucket = pool.get(key(f));
    if (bucket?.length) { allowed.push({ finding: f, entry: bucket.shift() }); } else violations.push(f);
  }
  const stale = [...pool.values()].flat();
  const expired = (list?.entries ?? []).filter((e) => entryAgeDays(e, today) > MAX_AGE_DAYS);
  return { violations, allowed, stale, expired, problems };
}

/** Build an allowlist from findings, keeping the added date and note of entries that already exist (so a prune never resets the 14-day clock). */
export function buildAllowlist(findings, previous, today) {
  const pool = new Map();
  for (const e of previous?.entries ?? []) { const k = key(e); (pool.get(k) ?? pool.set(k, []).get(k)).push(e); }
  const entries = findings.map((f) => {
    const prev = pool.get(key(f))?.shift();
    return { rule: f.rule, file: f.file, line: f.line, detail: f.detail, added: prev?.added ?? today, note: prev?.note ?? `pending ${ownerTask(f)}` };
  });
  return { schema_version: 1, entries };
}

/** One entry per line so a diff of the allowlist reads as the list shrinking. */
export function formatAllowlist(list) {
  const rows = list.entries.map((e) => "    " + JSON.stringify({ rule: e.rule, file: e.file, line: e.line, detail: e.detail, added: e.added, note: e.note }));
  return `{\n  "schema_version": 1,\n  "entries": [\n${rows.join(",\n")}\n  ]\n}\n`;
}
