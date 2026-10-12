// @vitest-environment node
// MPT-1003: the English output is pinned here so a copy change is always a deliberate edit of both the locale file and this test.
// MPC-7251 follow-up (2026-10-12): wording rewritten to match what the free scan really does (needs Chris's approval before merge).
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveLocale, t, firstHexagon, confirmedY, confirmedN, unknown, confirmPrompt } from "./messages.js";
import worker from "./index.js";
import master from "../../locales/master_keys.json";

const FIRST_HEXAGON = `🔍 *Here's what the free MyPrivacyTOOL scan looks at:*

• What your browser and device reveal to every website you visit
• What your IP address reveals, such as your approximate city and country
• What your email address reveals, such as its provider and any public profile
• Breach history: not checked automatically yet, so your report gives you a link to check it yourself
• People-search sites: your report has opt-out guides to follow step by step
• Data broker databases: not searched yet, and I'll say so plainly in your report

---
I can't see your Telegram profile, phone number or contacts, only what you type here. Want to run the scan now?

Reply *Y* and I'll send you the link.

Reply *N* if you'd rather not for now.`;

const CONFIRMED_Y = `✅ *Great.*

You run the scan in your browser.

👉 Start here:
https://myprivacytool.io/scan

When it's done, give your email and we'll send you your report.`;

const CONFIRMED_N = `👍 *No problem.*

Whenever you want to run the free scan, it's here:
https://myprivacytool.io/scan

Say *"scan me"* any time to see this again.`;

const UNKNOWN = `👋 *Welcome to MyPrivacyTOOL.*

Say *"scan me"* and I'll tell you what our free scan looks at and send you the link to run it.

It's free. You'll be asked for your email so we can send your report.`;

describe("English output is as approved", () => {
  it.each([
    ["first hexagon", firstHexagon("en"), FIRST_HEXAGON],
    ["confirmed Y", confirmedY("en"), CONFIRMED_Y],
    ["confirmed N", confirmedN("en"), CONFIRMED_N],
    ["unknown", unknown("en"), UNKNOWN],
    ["confirm prompt", confirmPrompt("en"), "Reply *Y* to get the link to the free scan, or *N* if you'd rather not."],
  ])("%s", (_n, got, want) => expect(got).toBe(want));
});

describe("locale resolution and fallback", () => {
  it("maps Telegram language codes to a supported locale, else en", () => {
    expect(resolveLocale("ja")).toBe("ja");
    expect(resolveLocale("pt-BR")).toBe("pt");
    expect(resolveLocale("zh-hans")).toBe("zh");
    expect(resolveLocale("ru")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("__proto__")).toBe("en");
  });
  it("falls back to English for untranslated (empty) placeholder values", () => {
    expect(firstHexagon("ja")).toBe(FIRST_HEXAGON);
    expect(t("bot.unknown.title", "ar")).toBe("👋 *Welcome to MyPrivacyTOOL.*");
  });
  it("every master key resolves to non-empty English text", () => {
    for (const { key } of master.keys) expect(t(key, "en"), key).not.toBe("");
  });
});

describe("worker replies in the sender's locale", () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = async (from, text, stage = "new") => {
    const sent = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).includes("/sendMessage")) sent.push(JSON.parse(init.body));
      return { json: async () => ({}) };
    }));
    const kv = { get: async () => JSON.stringify({ stage }), put: async () => {} };
    const req = new Request("https://x/", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "s" },
      body: JSON.stringify({ message: { chat: { id: 7 }, text, from } }),
    });
    const res = await worker.fetch(req, { WEBHOOK_SECRET: "s", MPT_KV: kv, TELEGRAM_BOT_TOKEN: "t", HUBSPOT_API_KEY: "h" });
    return { res, sent };
  };
  it("first message gets the first hexagon", async () => {
    const { res, sent } = await run({ first_name: "A", language_code: "ja" }, "hi");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(FIRST_HEXAGON); // ja is a placeholder, so English until translated
  });
  it("Y and N and invalid replies", async () => {
    expect((await run({}, "y", "awaiting_confirmation")).sent[0].text).toBe(CONFIRMED_Y);
    expect((await run({}, "no", "awaiting_confirmation")).sent[0].text).toBe(CONFIRMED_N);
    expect((await run({}, "?", "awaiting_confirmation")).sent[0].text).toBe("Reply *Y* to get the link to the free scan, or *N* if you'd rather not.");
    expect((await run({}, "x", "confirmed")).sent[0].text).toBe(UNKNOWN);
  });
});
