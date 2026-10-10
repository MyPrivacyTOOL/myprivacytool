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
import type { Logger } from "./logger";
import type { Env } from "./shared";

const SCAN_URL = "https://myprivacytool.io/scan";
const CATALOGS: Record<string, Record<string, string>> = { en, ja, zh, ko, vi, es, de, fr, pt, ar };
const TELEGRAM_TIMEOUT_MS = 5000;

/** Text that follows a key before the next key (default: a line break). Mirrors workers/telegram-webhook/messages.js. */
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

/** Reads core-brain's answer and, if it carries message keys, sends the reply. Never throws: a failed send is logged only. */
export async function sendTelegramReply(env: Env, update: unknown, brain: Response, log: Logger): Promise<void> {
  try {
    const chatId = replyTarget(update);
    if (chatId === null) return;
    const body = (await brain.json()) as { ignored?: boolean; message_keys?: unknown; locale?: unknown };
    if (body.ignored) return;
    const reply = composeReply(body.message_keys, body.locale);
    if (!reply) return log.warn("reply_empty");
    if (!env.TELEGRAM_BOT_TOKEN) return log.warn("bot_token_unset");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TELEGRAM_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: "Markdown" }),
        signal: ctl.signal,
      });
      if (!res.ok) log.error("telegram_send_rejected", { status: res.status });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log.error("telegram_send_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
