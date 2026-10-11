// On-device spam log (MPC-7446). Lives in localStorage only: nothing is sent to a server, so the user can
// copy it into an OFCA complaint (or the Police) when they choose to.
export const SPAM_LOG_KEY = "mpt_hk_spam_log";
export const SPAM_LOG_MAX = 200;

export type SpamKind = "call" | "sms";

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
    (e.kind === "call" || e.kind === "sms") &&
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
  const kind = (k: SpamKind) => (lang === "zh" ? (k === "call" ? "來電" : "短訊") : k === "call" ? "Call" : "SMS");
  return [...entries]
    .reverse()
    .map((e) => `${fmt.format(new Date(e.at))} | ${kind(e.kind)} | ${e.sender}${e.note ? ` | ${e.note}` : ""}`)
    .join("\n");
}
