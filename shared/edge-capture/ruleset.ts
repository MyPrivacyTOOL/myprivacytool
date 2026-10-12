// MPC-7490: the versioned rule list that sorts one request into person / bot / ai / unknown, using only signals available on the
// free Cloudflare plan (user agent, network owner, header sanity). First match wins; the order is the order of this array.
// Anything no rule matches is "person" by rule R8. "unknown" is treated as a person everywhere (see treatAsPerson).
// Change a rule or the order => bump RULESET_VERSION. Every stored row carries the version and the id of the deciding rule.
// Built from the proposal in docs/inbound-funnel-inventory.md section 6. R7 (no browser event follows the page fetch) cannot be
// decided at the edge alone, so it is not in this version.

export const RULESET_VERSION = "2026-10-12.1";

export type VisitClass = "person" | "bot" | "ai" | "unknown";

export interface RequestFacts {
  userAgent: string;
  /** Network owner name from request.cf.asOrganization, if present. */
  asnOrg: string | null;
  /** Request headers, names lower-cased. */
  headers: Record<string, string | undefined>;
  /** request.cf.httpProtocol, e.g. "HTTP/2". */
  httpProtocol: string | null;
}

export interface Rule {
  id: string;
  cls: VisitClass;
  description: string;
  test: (f: RequestFacts) => boolean;
}

const has = (ua: string, tokens: string[]): boolean => {
  const u = ua.toLowerCase();
  return tokens.some((t) => u.includes(t.toLowerCase()));
};

export const AI_TOKENS = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "PerplexityBot",
  "Perplexity-User", "CCBot", "Bytespider", "Amazonbot", "Applebot-Extended", "Google-Extended", "meta-externalagent",
  "meta-externalfetcher", "cohere-ai", "Diffbot", "YouBot", "MistralAI-User",
];
export const SEARCH_BOT_TOKENS = ["Googlebot", "Bingbot", "DuckDuckBot", "YandexBot", "Baiduspider", "Applebot", "Slurp"];
export const SCRAPER_TOKENS = [
  "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "UptimeRobot", "Pingdom", "curl/", "python-requests", "Go-http-client", "okhttp",
  "Scrapy", "HeadlessChrome", "PhantomJS", "node-fetch", "wget/", "libwww-perl", "Java/", "axios/", "aiohttp",
];
/** Generic word at the end of a UA token: "...bot", "...crawler", "spider", "scraper", "fetcher", "monitor". Low precision; runs after the named lists. */
const GENERIC_BOT = /(?:bot|crawler|spider|scraper|fetcher|monitor)(?:[^a-z]|$)/i;
/** Hosting and cloud networks. A normal browser UA coming from one is suspicious, not proof (corporate VPNs live there too). */
const DATACENTER_ORG =
  /amazon|aws|google (llc|cloud)|microsoft|azure|digitalocean|hetzner|ovh|linode|akamai connected|vultr|oracle|alibaba|tencent|contabo|leaseweb|scaleway|choopa|m247|datacamp|cloudflare/i;
const BROWSER_UA = /mozilla\/|chrome\/|safari\/|firefox\/|edg\//i;

export const RULES: Rule[] = [
  { id: "R1", cls: "ai", description: "user agent carries a known AI crawler or AI agent token", test: (f) => has(f.userAgent, AI_TOKENS) },
  { id: "R2", cls: "bot", description: "user agent carries a known search crawler token", test: (f) => has(f.userAgent, SEARCH_BOT_TOKENS) },
  { id: "R3", cls: "bot", description: "user agent carries an SEO, scraper, scanner, monitor or script-client token", test: (f) => has(f.userAgent, SCRAPER_TOKENS) },
  { id: "R4", cls: "bot", description: "user agent contains a generic bot word (bot, crawler, spider, scraper, fetcher, monitor)", test: (f) => GENERIC_BOT.test(f.userAgent) },
  {
    id: "R5",
    cls: "unknown",
    description: "browser-looking user agent from a hosting or cloud network",
    test: (f) => !!f.asnOrg && DATACENTER_ORG.test(f.asnOrg) && BROWSER_UA.test(f.userAgent),
  },
  {
    id: "R6",
    cls: "bot",
    description: "no user agent, or none of the headers every real browser sends (Accept, Accept-Language), or HTTP/1.0",
    test: (f) =>
      f.userAgent.trim() === "" ||
      (!f.headers["accept-language"] && !f.headers["accept"]) ||
      (f.httpProtocol ?? "").toUpperCase() === "HTTP/1.0",
  },
];

/** Used when no rule matches. */
export const FALLBACK_RULE = { id: "R8", cls: "person" as VisitClass, description: "no rule matched: treated as a person" };
/** Used if classification itself throws. Never blocks capture. */
export const ERROR_RULE = { id: "ERR", cls: "unknown" as VisitClass };
