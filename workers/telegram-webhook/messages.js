/**
 * MPT-1003: bot response text comes from /locales (seed for the Supabase `localization` table), keyed by
 * the dotted keys in locales/master_keys.json. English is the fallback for any locale or key that is not
 * translated yet (placeholder locales hold empty strings). The scan URL is appended here, not in the text.
 */
import en from "../../locales/en/main.json";
import ja from "../../locales/ja/main.json";
import zh from "../../locales/zh/main.json";
import ko from "../../locales/ko/main.json";
import vi from "../../locales/vi/main.json";
import es from "../../locales/es/main.json";
import de from "../../locales/de/main.json";
import fr from "../../locales/fr/main.json";
import pt from "../../locales/pt/main.json";
import ar from "../../locales/ar/main.json";

const SCAN_URL = "https://myprivacytool.io/scan";
const CATALOGS = { en, ja, zh, ko, vi, es, de, fr, pt, ar };

/** Telegram `language_code` (IETF tag, e.g. "pt-br", "zh-hans") -> a supported locale, else "en". */
export function resolveLocale(languageCode) {
  const primary = String(languageCode || "").toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(CATALOGS, primary) ? primary : "en";
}

export function t(key, locale = "en") {
  return CATALOGS[locale]?.[key] || en[key] || "";
}

const join = (...lines) => lines.join("\n");

export function firstHexagon(locale) {
  const k = (s) => t(`bot.first_hexagon.${s}`, locale);
  return join(
    k("title"), "",
    k("name"), k("location"), k("phone"), k("email"), k("social"), k("brokers"), "",
    "---",
    k("question"), "",
    k("reply_y"), "",
    k("reply_n"),
  );
}

export function confirmedY(locale) {
  const k = (s) => t(`bot.confirmed_y.${s}`, locale);
  return join(k("title"), "", k("generating"), "", k("cta"), SCAN_URL, "", k("duration"));
}

export function confirmedN(locale) {
  const k = (s) => t(`bot.confirmed_n.${s}`, locale);
  return join(k("title"), "", k("cta"), SCAN_URL, "", k("duration"));
}

export function unknown(locale) {
  const k = (s) => t(`bot.unknown.${s}`, locale);
  return join(k("title"), "", k("body"), "", k("free"));
}

export const confirmPrompt = (locale) => t("bot.confirm_prompt", locale);
