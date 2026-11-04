// On-device spam log (MPC-7446). Lives in localStorage only: nothing is sent to a server, so the user can
// copy it into an OFCA complaint (or the Police) when they choose to.
export const SPAM_LOG_KEY = "mpt_hk_spam_log";
export const SPAM_LOG_MAX = 200;

/** "call" is the pre-split kind from the first release; it is still read and shown, never written. */
export type SpamKind = "sms" | "recorded" | "live" | "call";
export const SPAM_KINDS: readonly SpamKind[] = ["sms", "recorded", "live"];

export interface SpamLogEntry {
  id: string;
  kind: SpamKind;
  sender: string;
  note: string;
  /** ISO timestamp of when the user logged it. */
  at: string;
}

function isEntry(v: unknown): v is SpamLogEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    (e.kind === "call" || e.kind === "sms" || e.kind === "recorded" || e.kind === "live") &&
    typeof e.sender === "string" &&
    typeof e.note === "string" &&
    typeof e.at === "string"
  );
}

export function loadSpamLog(): SpamLogEntry[] {
  try {
    const raw = localStorage.getItem(SPAM_LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function save(entries: SpamLogEntry[]): void {
  try {
    localStorage.setItem(SPAM_LOG_KEY, JSON.stringify(entries));
  } catch {
    // storage full or blocked: the in-memory list still works for this visit
  }
}

/** Adds one entry (newest first, capped). Returns the new list, or the unchanged list when sender is empty. */
export function addSpamLogEntry(
  entries: SpamLogEntry[],
  input: { kind: SpamKind; sender: string; note?: string },
  now: Date = new Date(),
): SpamLogEntry[] {
  const sender = input.sender.trim().slice(0, 60);
  if (!sender) return entries;
  const entry: SpamLogEntry = {
    id: `${now.getTime()}-${entries.length}`,
    kind: input.kind,
    sender,
    note: (input.note ?? "").trim().slice(0, 200),
    at: now.toISOString(),
  };
  const next = [entry, ...entries].slice(0, SPAM_LOG_MAX);
  save(next);
  return next;
}

export function removeSpamLogEntry(entries: SpamLogEntry[], id: string): SpamLogEntry[] {
  const next = entries.filter((e) => e.id !== id);
  save(next);
  return next;
}

export function clearSpamLog(): SpamLogEntry[] {
  save([]);
  return [];
}

/** Plain text, oldest first, with the Hong Kong date and time, ready to paste into a complaint. */
export function spamLogToText(entries: SpamLogEntry[], lang: "en" | "zh"): string {
  const fmt = new Intl.DateTimeFormat(lang === "zh" ? "zh-HK" : "en-HK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hong_Kong",
  });
  return [...entries]
    .reverse()
    .map((e) => `${fmt.format(new Date(e.at))} | ${spamKindLabel(e.kind, lang)} | ${e.sender}${e.note ? ` | ${e.note}` : ""}`)
    .join("\n");
}

const KIND_LABEL: Record<"en" | "zh", Record<SpamKind, string>> = {
  en: { sms: "SMS", recorded: "Recorded call", live: "Live call", call: "Call" },
  zh: { sms: "短訊", recorded: "錄音來電", live: "真人來電", call: "來電" },
};
export function spamKindLabel(k: SpamKind, lang: "en" | "zh"): string {
  return KIND_LABEL[lang][k];
}

function csvCell(v: string): string {
  // Quote every cell; also defuse spreadsheet formulas (a leading = + - @ would run when opened in Excel).
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV for the export button: number/sender, Hong Kong date and time, type, note. Oldest first. */
export function spamLogToCsv(entries: SpamLogEntry[], lang: "en" | "zh"): string {
  const head = lang === "zh" ? ["號碼或發送者", "日期及時間（香港）", "類別", "備註"] : ["Number or sender", "Date and time (Hong Kong)", "Type", "Note"];
  const fmt = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Hong_Kong", hour12: false });
  const rows = [...entries].reverse().map((e) => [e.sender, fmt.format(new Date(e.at)), spamKindLabel(e.kind, lang), e.note]);
  // BOM so Excel reads the Chinese headings as UTF-8.
  return `\uFEFF${[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Saves the CSV through a temporary download link. Resolves false when the browser blocks it; never throws. */
export function downloadSpamLog(entries: SpamLogEntry[], lang: "en" | "zh"): boolean {
  try {
    const blob = new Blob([spamLogToCsv(entries, lang)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hk-spam-log.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
