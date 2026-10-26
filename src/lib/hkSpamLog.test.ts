// MPC-7446: on-device spam log (localStorage only).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPAM_LOG_KEY,
  SPAM_LOG_MAX,
  addSpamLogEntry,
  clearSpamLog,
  loadSpamLog,
  removeSpamLogEntry,
  downloadSpamLog,
  spamKindLabel,
  spamLogToCsv,
  spamLogToText,
} from "./hkSpamLog";

beforeEach(() => localStorage.clear());

describe("spam log", () => {
  it("adds newest first, persists to localStorage and reloads", () => {
    const a = addSpamLogEntry([], { kind: "recorded", sender: " +852 5555 0000 ", note: "loan offer" }, new Date("2026-10-11T02:00:00Z"));
    const b = addSpamLogEntry(a, { kind: "sms", sender: "BrandX" }, new Date("2026-10-11T03:00:00Z"));
    expect(b.map((e) => e.sender)).toEqual(["BrandX", "+852 5555 0000"]);
    expect(b[1].note).toBe("loan offer");
    expect(loadSpamLog()).toEqual(b);
    expect(JSON.parse(localStorage.getItem(SPAM_LOG_KEY) as string)).toHaveLength(2);
  });

  it("ignores an empty sender and caps the list", () => {
    const empty: ReturnType<typeof loadSpamLog> = [];
    expect(addSpamLogEntry(empty, { kind: "live", sender: "   " })).toBe(empty);
    let list = empty;
    for (let i = 0; i < SPAM_LOG_MAX + 5; i++) list = addSpamLogEntry(list, { kind: "sms", sender: `n${i}` }, new Date(1000 + i));
    expect(list).toHaveLength(SPAM_LOG_MAX);
    expect(list[0].sender).toBe(`n${SPAM_LOG_MAX + 4}`);
  });

  it("removes one entry and clears all", () => {
    const list = addSpamLogEntry(addSpamLogEntry([], { kind: "call", sender: "a" }), { kind: "call", sender: "b" });
    const after = removeSpamLogEntry(list, list[0].id);
    expect(after.map((e) => e.sender)).toEqual(["a"]);
    expect(loadSpamLog()).toEqual(after);
    expect(clearSpamLog()).toEqual([]);
    expect(loadSpamLog()).toEqual([]);
  });

  it("survives corrupt or hostile stored data", () => {
    localStorage.setItem(SPAM_LOG_KEY, "{not json");
    expect(loadSpamLog()).toEqual([]);
    localStorage.setItem(SPAM_LOG_KEY, JSON.stringify([{ id: 1 }, "x", null, { id: "1", kind: "sms", sender: "ok", note: "", at: "2026-10-11T00:00:00Z" }]));
    expect(loadSpamLog()).toHaveLength(1);
    localStorage.setItem(SPAM_LOG_KEY, JSON.stringify({ not: "an array" }));
    expect(loadSpamLog()).toEqual([]);
  });

  it("exports oldest first as plain text in either language", () => {
    const a = addSpamLogEntry([], { kind: "recorded", sender: "first", note: "n1" }, new Date("2026-10-11T02:00:00Z"));
    const b = addSpamLogEntry(a, { kind: "sms", sender: "second" }, new Date("2026-10-11T03:00:00Z"));
    const en = spamLogToText(b, "en").split("\n");
    expect(en).toHaveLength(2);
    expect(en[0]).toContain("Recorded call | first | n1");
    expect(en[1]).toContain("SMS | second");
    const zh = spamLogToText(b, "zh");
    expect(zh).toContain("錄音來電 | first");
    expect(zh).toContain("短訊 | second");
  });

  it("labels all three types plus the legacy 'call' kind in both languages", () => {
    expect(spamKindLabel("sms", "en")).toBe("SMS");
    expect(spamKindLabel("recorded", "en")).toBe("Recorded call");
    expect(spamKindLabel("live", "en")).toBe("Live call");
    expect(spamKindLabel("live", "zh")).toBe("真人來電");
    expect(spamKindLabel("call", "en")).toBe("Call");
  });

  it("still loads entries saved by the first release (kind 'call')", () => {
    localStorage.setItem(SPAM_LOG_KEY, JSON.stringify([{ id: "1", kind: "call", sender: "old", note: "", at: "2026-10-11T00:00:00Z" }]));
    expect(loadSpamLog()).toHaveLength(1);
  });

  it("exports CSV with number, Hong Kong date and time, type and note, and defuses spreadsheet formulas", () => {
    const a = addSpamLogEntry([], { kind: "live", sender: "=HYPERLINK(\"x\")", note: 'said "hi"' }, new Date("2026-10-11T02:00:00Z"));
    const csv = spamLogToCsv(a, "en");
    const [head, row] = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(head).toBe('"Number or sender","Date and time (Hong Kong)","Type","Note"');
    expect(row).toContain("\"'=HYPERLINK(");
    expect(row).toContain('"Live call"');
    expect(row).toContain('"said ""hi"""');
    expect(row).toContain("2026-10-11"); // 10:00 Hong Kong time
    expect(spamLogToCsv(a, "zh")).toContain("真人來電");
  });

  it("download saves a CSV through a temporary link, and returns false (never throws) when blocked", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const define = (fn: unknown) => Object.defineProperty(URL, "createObjectURL", { value: fn, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true, writable: true });
    define(() => "blob:test");
    expect(downloadSpamLog([], "en")).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    define(() => {
      throw new Error("blocked");
    });
    expect(downloadSpamLog([], "en")).toBe(false);
    click.mockRestore();
  });
});
