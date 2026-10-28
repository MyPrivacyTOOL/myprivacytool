// MPC-7251: turns core-brain's response keys into the Telegram reply text and sends it.
// core-brain only decides *which* message to send (message_keys + locale); delivery lives here, next to the token.
import en from "../../../locales/en/main.json";
import ja from "../../../locales/ja/main.json";
import zh from "../../../locales/zh/main.json";
import ko from "../../../locales/ko/main.json";
import vi from "../../../locales/vi/main.json";
import es from "../../../locales/es/main.json";
import de from "../../../locales/de/main.json";
import fr from "../../../locales/fr/main.json";
import pt from "../../../locales/pt/main.json";
import ar from "../../../locales/ar/main.json";
import type { EventLog } from "./event-log";
import type { Logger } from "./logger";
import type { Env } from "./shared";
import { telegramCaptureEnabled } from "./telegram-capture";

// MPC-7641: tagged so GA4 and leads can attribute clicks, scans and sign-ups to this channel (utm_medium=channel_osint, utm_source = platform).
const SCAN_URL = "https://myprivacytool.io/scan?utm_source=telegram&utm_medium=channel_osint&utm_campaign=bot_reply";
const CATALOGS: Record<string, Record<string, string>> = { en, ja, zh, ko, vi, es, de, fr, pt, ar };
const TELEGRAM_TIMEOUT_MS = 5000;

// MPC-7641: Telegram's legacy Markdown reads "_" as italics, which would break the UTM-tagged links. Escape them inside URLs only.
export const escapeUrlUnderscores = (text: string): string => text.replace(/https?:\/\/\S+/g, (u) => u.replace(/_/g, "\\_"));

/** Text that follows a key before the next key (default: a line break). */
const AFTER: Record<string, string> = {
  "bot.first_hexagon.title": "\n\n",
  "bot.first_hexagon.brokers": "\n\n---\n",
  "bot.first_hexagon.question": "\n\n",
  "bot.first_hexagon.reply_y": "\n\n",
  "bot.confirmed_y.title": "\n\n",
  "bot.confirmed_y.generating": "\n\n",
  "bot.confirmed_y.cta": `\n${SCAN_URL}\n\n`,
  "bot.confirmed_n.title": "\n\n",
  "bot.confirmed_n.cta": `\n${SCAN_URL}\n\n`,
  "bot.unknown.title": "\n\n",
  "bot.unknown.body": "\n\n",
};

const text = (key: string, locale: string) => CATALOGS[locale]?.[key] || en[key as keyof typeof en] || "";

/** Joins localized values for the keys, in order. Unknown keys and keys with no text (any locale) are skipped. */
export function composeReply(keys: unknown, locale: unknown): string {
  if (!Array.isArray(keys)) return "";
  const loc = typeof locale === "string" ? locale : "en";
  let out = "";
  let sep = "";
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const value = text(key, loc);
    if (!value) continue;
    out += sep + value;
    sep = AFTER[key] ?? "\n";
  }
  return out;
}

/** The chat to answer, or null for updates with no user message (edits, joins, channel posts, ...). */
export function replyTarget(update: unknown): number | string | null {
  const id = (update as { message?: { chat?: { id?: unknown } } } | null)?.message?.chat?.id;
  return typeof id === "number" || (typeof id === "string" && id !== "") ? id : null;
}

/** CK-8502: owner-approved disclosure (2026-10-28), appended to every reply while TELEGRAM_CAPTURE_HEXAGONS is on. English only until the 10 locale files carry a reviewed translation. */
export const CAPTURE_DISCLOSURE = "To reply, I keep the details Telegram sends me with your messages (your name, @username, language and what you write). Send STOP any time and I'll delete them.";

/** Reads core-brain's answer and, if it carries message keys, sends the reply. Never throws: a failed send is logged only. */
export async function sendTelegramReply(env: Env, update: unknown, brain: Response, log: Logger, events?: EventLog | null): Promise<void> {
  try {
    const chatId = replyTarget(update);
    if (chatId === null) return;
    const body = (await brain.json()) as { ignored?: boolean; message_keys?: unknown; locale?: unknown };
    if (body.ignored) return;
    const composed = composeReply(body.message_keys, body.locale);
    const reply = composed && telegramCaptureEnabled(env) ? `${composed}\n\n${CAPTURE_DISCLOSURE}` : composed;
    if (!reply) return log.warn("reply_empty");
    if (!env.TELEGRAM_BOT_TOKEN) return log.warn("bot_token_unset");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TELEGRAM_TIMEOUT_MS);
    const request = { chat_id: chatId, text: escapeUrlUnderscores(reply), parse_mode: "Markdown" };
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: ctl.signal,
      });
      if (!res.ok) log.error("telegram_send_rejected", { status: res.status });
      if (events) events.out("sendMessage", request, { status: res.status, response: await res.json().catch(() => null) });
    } catch (err) {
      events?.out("sendMessage", request, { status: 0, response: { error: err instanceof Error ? err.name : "unknown" } });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log.error("telegram_send_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
