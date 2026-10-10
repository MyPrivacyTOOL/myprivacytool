// @vitest-environment node
// MPT-1003: the English output must stay byte-identical to the strings the worker hardcoded before it read /locales.
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveLocale, t, firstHexagon, confirmedY, confirmedN, unknown, confirmPrompt } from "./messages.js";
import worker from "./index.js";
import master from "../../locales/master_keys.json";

const FIRST_HEXAGON = `🔍 *Here's what's publicly known about you right now:*

✅ Name: visible from your Telegram profile
✅ Location: city & country estimable from IP
⚠️ Phone: possibly linked to this account
⚠️ Email: may be findable via data brokers
⚠️ Social profiles: cross-platform links detected
🚨 Data broker exposure: estimated 40+ sites

---
Is this data about you?

Reply *Y* to see your full privacy report and start removing yourself from data broker sites.

Reply *N* if this profile doesn't match you — we'll run a fresh scan.`;

const CONFIRMED_Y = `✅ *Confirmed.*

Your full privacy report is being generated now.

👉 Go here to see it and start the removal process:
https://myprivacytool.io/scan

We'll walk you through every step. It takes about 5 minutes.`;

const CONFIRMED_N = `🔍 *No problem — let's find the right profile.*

Run a fresh scan with your details here:
https://myprivacytool.io/scan

Takes 30 seconds.`;

const UNKNOWN = `👋 *Welcome to MyPrivacyTOOL.*

Send me your name or just say *"scan me"* and I'll show you what data brokers know about you right now.

It's free. No signup needed.`;

describe("English output is unchanged", () => {
  it.each([
    ["first hexagon", firstHexagon("en"), FIRST_HEXAGON],
    ["confirmed Y", confirmedY("en"), CONFIRMED_Y],
    ["confirmed N", confirmedN("en"), CONFIRMED_N],
    ["unknown", unknown("en"), UNKNOWN],
    ["confirm prompt", confirmPrompt("en"), "Reply *Y* to confirm this is you, or *N* if not."],
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
    expect((await run({}, "?", "awaiting_confirmation")).sent[0].text).toBe("Reply *Y* to confirm this is you, or *N* if not.");
    expect((await run({}, "x", "confirmed")).sent[0].text).toBe(UNKNOWN);
  });
});
