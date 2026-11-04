// MPC-8689: the two "records about a person" extra hexagons (channel "Data brokers and news archives", code DB):
//   brokers.people_search_listing  "Listing on a people-search site"
//   brokers.news_archive_mention   "Named in a news archive"
// Owner decisions of 2026-10-29. The ONLY input is a page address the person supplies, together with the name or email they want looked for:
//   /listing <https-url> <name or email>      /archive <https-url> <name or email>
// Nothing is ever searched for: no search engine, no people-search query, no name sent to any site. The Worker fetches that one address (a short redirect
// chain at most; no cookies, no referrer, no identifying details, a size cap and a time limit) and looks for the typed text ON THE FETCHED PAGE, locally.
// The text the person typed goes nowhere else. Nothing is stored and nothing from the page or the request is logged (counts-only: kind, result, reason code).
// Result rules (never show a result that was not checked):
//   found        the name or email is on the page
//   clear        ONLY when the page loaded normally and it is absent, or the site says the page no longer exists (404 or 410)
//   not_checked  everything else: blocked, challenged, timed out, too big to read in full, not a web page, unsafe address. Never "clear".
// Off unless RECORDS_CHECK=on, allow-listed senders only (PROBE_TELEGRAM_IDS), outside the 54, scanCounts and the exposure score; both stay status "new".
// We submit nothing for the person: for a found listing we only show the service's own stated removal route, labelled as such.
import type { Logger } from "./logger";
import { call, probeIds, telegramSender } from "./probe-reader";
import type { Env } from "./shared";

export const recordsCheckEnabled = (env: Env): boolean => env.RECORDS_CHECK === "on";

export type RecordsKind = "people_search" | "news_archive";
export type RecordsStatus = "found" | "clear" | "not_checked";
export interface RecordsResult { status: RecordsStatus; reason: string }
export interface RecordsRequest { kind: RecordsKind; url: string; term: string }

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MIN_TERM = 3;
const MAX_TERM = 100;
const COOLDOWN_MS = 15_000;
const UA = "Mozilla/5.0 (compatible; MyPrivacyTOOL-page-check)";

const ID: Record<RecordsKind, string> = { people_search: "brokers.people_search_listing", news_archive: "brokers.news_archive_mention" };
const LABEL: Record<RecordsKind, string> = { people_search: "Listing on a people-search site", news_archive: "Named in a news archive" };

/** Exact commands only: "/listing <https-url> <term>" or "/archive <https-url> <term>" (optionally "/listing@BotName"). The term is everything after the address. */
export function parseRecordsCommand(text: unknown): RecordsRequest | { kind: RecordsKind; error: string } | null {
  if (typeof text !== "string") return null;
  const m = /^\/(listing|archive)(?:@\w+)?(?:\s+(\S+))?(?:\s+([\s\S]+))?$/i.exec(text.trim());
  if (!m) return null;
  const kind: RecordsKind = m[1].toLowerCase() === "listing" ? "people_search" : "news_archive";
  const term = (m[3] ?? "").replace(/\s+/g, " ").trim();
  if (!m[2] || !safeUrl(m[2])) return { kind, error: "address" };
  if (term.length < MIN_TERM || term.length > MAX_TERM) return { kind, error: "term" };
  return { kind, url: m[2], term };
}

/** An https address on a public-looking host. Not an IP address, not localhost or an internal name, no credentials, no odd port. Null otherwise. */
export function safeUrl(raw: string): URL | null {
  if (raw.length > 500) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const h = u.hostname.toLowerCase();
  if (h.length > 253 || !/^[a-z0-9.-]+$/.test(h) || !h.includes(".") || /^\d+(\.\d+){3}$/.test(h) || h.startsWith(".") || h.endsWith(".")) return null;
  if (h === "localhost" || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(h)) return null;
  return u;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(0x10ffff, parseInt(h, 16))))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(0x10ffff, parseInt(d, 10))))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** Visible text of a page, lower case, one space between words. */
export function pageText(html: string): string {
  return decode(html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().toLowerCase();
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The typed text, and for a two or three word name also "last, first" and "last first", since listings often show names that way. */
export function termVariants(term: string): string[] {
  const t = term.toLowerCase().replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  const out = new Set([t]);
  if (!t.includes("@") && words.length >= 2 && words.length <= 3) {
    const last = words[words.length - 1], rest = words.slice(0, -1).join(" ");
    out.add(`${last}, ${rest}`); out.add(`${last} ${rest}`);
  }
  return [...out];
}
export function containsTerm(haystack: string, term: string): boolean {
  return termVariants(term).some((v) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, "iu").test(haystack));
}

const CHALLENGE = /captcha|verify (that )?you are (a )?human|are you a robot|enable javascript|javascript (is )?(required|disabled)|access denied|just a moment|attention required|unusual traffic|checking your browser|request blocked/i;

/** Pure. Decides the result from what was fetched. */
export function classify(page: { status: number; contentType: string; body: string; truncated: boolean }, term: string): RecordsResult {
  const { status, contentType, body, truncated } = page;
  if (status === 404 || status === 410) return { status: "clear", reason: "gone" };
  if (status < 200 || status >= 300) return { status: "not_checked", reason: status === 403 || status === 401 || status === 429 || status === 451 ? "blocked" : `http_${status >= 500 ? "5xx" : "other"}` };
  if (!/^(text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(contentType)) return { status: "not_checked", reason: "not_a_web_page" };
  const text = pageText(body);
  if (containsTerm(text, term) || containsTerm(decode(body).toLowerCase(), term)) return { status: "found", reason: "on_page" };
  if (truncated) return { status: "not_checked", reason: "too_big_to_read_in_full" };
  if (text.length < 200 || CHALLENGE.test(text.length < 3000 ? text : text.slice(0, 3000))) return { status: "not_checked", reason: "page_did_not_show_content" };
  return { status: "clear", reason: "absent" };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function readCapped(res: Response): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: await res.text(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size > MAX_BYTES) { truncated = true; await reader.cancel().catch(() => undefined); break; }
  }
  const all = new Uint8Array(Math.min(size, MAX_BYTES + 65_536));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.byteLength, all.length - off); all.set(c.subarray(0, n), off); off += n; if (off >= all.length) break; }
  return { body: new TextDecoder("utf-8").decode(all.subarray(0, off)), truncated };
}

/** One check: a short redirect chain to the supplied address, nothing else. Never throws. */
export async function checkPage(req: RecordsRequest, fetchImpl: FetchLike = fetch): Promise<RecordsResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let url = safeUrl(req.url);
    for (let hop = 0; url; hop++) {
      const res = await fetchImpl(url.href, {
        method: "GET", redirect: "manual", signal: ctl.signal,
        headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9", "User-Agent": UA }, // no cookie, no referrer, nothing about the person
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!loc || hop >= MAX_REDIRECTS) return { status: "not_checked", reason: "too_many_redirects" };
        let next: URL | null = null;
        try { next = safeUrl(new URL(loc, url).href); } catch { next = null; }
        if (!next) return { status: "not_checked", reason: "redirect_to_unsafe_address" };
        url = next;
        continue;
      }
      const { body, truncated } = await readCapped(res);
      return classify({ status: res.status, contentType: res.headers.get("content-type") ?? "", body, truncated }, req.term);
    }
    return { status: "not_checked", reason: "unsafe_address" };
  } catch {
    return { status: "not_checked", reason: ctl.signal.aborted ? "timed_out" : "could_not_fetch" };
  } finally {
    clearTimeout(timer);
  }
}

// The service's own stated removal route, with the wording from the first-pass assessment (read 2026-10-28; page reachable 2026-10-29). Add a host only after reading its page.
const STATED_ROUTES: { host: string; text: string }[] = [
  { host: "spokeo.com", text: "Spokeo's opt-out page (https://www.spokeo.com/optout) says to opt out each listing by its profile address plus email confirmation, about 24 to 48 hours. It also says data can reappear and stays at the original source." },
];
export const statedRoute = (host: string): string | null => STATED_ROUTES.find((r) => host === r.host || host.endsWith(`.${r.host}`))?.text ?? null;

const WHY: Record<string, string> = {
  blocked: "the site refused the request", http_5xx: "the site had an error", http_other: "the site answered with something unexpected", not_a_web_page: "the address is not a web page",
  too_big_to_read_in_full: "the page was too big to read in full, and what you typed was not in the part I read", page_did_not_show_content: "the page did not show readable content (it may need a browser or a human check)",
  too_many_redirects: "the address redirected too many times", redirect_to_unsafe_address: "the address redirected somewhere I will not fetch", unsafe_address: "the address is not one I will fetch",
  timed_out: "the site took too long", could_not_fetch: "I could not reach the site",
};
const NOTHING_STORED = "Nothing from this check was stored.";

export function recordsReply(req: RecordsRequest, r: RecordsResult, host: string): string {
  const head = `Extra check (not part of your number): ${LABEL[req.kind]}.`;
  if (r.status === "found") {
    const route = req.kind === "people_search"
      ? (statedRoute(host) ? `Removal route, stated by the service: ${statedRoute(host)}` : `I do not have a verified removal route for ${host}; look for its opt-out or privacy page.`)
      : `I do not have a verified removal route for ${host}; look for the outlet's corrections or removal page.`;
    return `${head} Found: the page at ${host} shows what you typed.\n${route}\nI submit nothing for you. After the site has removed it, send the same command again; this turns clear only when the page is gone or no longer shows it. ${NOTHING_STORED}`;
  }
  if (r.status === "clear") {
    return `${head} Clear: ${r.reason === "gone" ? `${host} says that page no longer exists.` : `the page at ${host} loaded normally and does not show what you typed.`} That is about this one page only. ${NOTHING_STORED}`;
  }
  return `${head} Not checked: ${WHY[r.reason] ?? "I could not check it"}. This is NOT a clear result. ${NOTHING_STORED}`;
}

const USAGE = "Records check (off the record: nothing is stored). Send /listing <https address of the page> <your name or email> for a people-search listing, or /archive <address> <your name or email> for a news-archive page. I fetch only that one page and look for what you typed on it; I never search for you.";
const BAD: Record<string, string> = { address: "That address does not work: it must be a full https:// address of a public web page.", term: `The name or email to look for must be ${MIN_TERM} to ${MAX_TERM} characters, after the address.` };

export function isRecordsCommand(env: Env, update: unknown): boolean {
  if (!recordsCheckEnabled(env)) return false;
  const s = telegramSender(update);
  if (!s || !probeIds(env).has(s.id)) return false;
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/(listing|archive)(@\w+)?(\s|$)/i.test(text.trim());
}

const lastCheck = new Map<string, number>();

/** Never throws; logs counts only (kind, result, reason code), never the address, the host, the typed text or the page. */
export async function handleRecordsCheck(env: Env, update: unknown, log: Logger, fetchImpl: FetchLike = fetch): Promise<void> {
  const s = telegramSender(update);
  if (!s || !env.TELEGRAM_BOT_TOKEN) return;
  try {
    const parsed = parseRecordsCommand((update as { message?: { text?: unknown } }).message?.text);
    if (!parsed) return;
    let text: string;
    if ("error" in parsed) text = `${BAD[parsed.error]}\n\n${USAGE}`;
    else {
      const now = Date.now(), prev = lastCheck.get(s.id);
      if (prev !== undefined && now - prev < COOLDOWN_MS) text = "One check at a time, please: wait a few seconds and send it again.";
      else {
        lastCheck.set(s.id, now);
        if (lastCheck.size > 200) for (const [k, t] of lastCheck) if (now - t >= COOLDOWN_MS) lastCheck.delete(k);
        const result = await checkPage(parsed, fetchImpl);
        text = recordsReply(parsed, result, new URL(parsed.url).hostname.toLowerCase());
        log.info("records_check", { id: ID[parsed.kind], result: result.status, reason: result.reason });
      }
    }
    await call(env, "sendMessage", { chat_id: s.chatId, text, link_preview_options: { is_disabled: true } });
  } catch (err) {
    log.warn("records_check_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
