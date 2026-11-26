// MPC-9907 (F8 pass 2, finish): blog, worker, locale, FAQ and retention copy obey the same truth rules as the legal pages.
// Facts: no automated removal and no monitoring alerts are live (Terms: "planned, not available today"); paid plans are not open;
// the free scan searches no broker site, public record or breach database (workers/scan-report/lib/brokerPanel.js: a listing is checked
// only when the visitor pastes the page that lists them).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "@testing-library/react";
import { renderPage } from "@/test/render";
import { FEATURE_STATUS } from "@/config/featureStatus";
import { guides } from "@/content/guides";
import blogPosts from "@/data/blogPosts.json";
import { FAQS } from "@/data/faqs";
import Privacy from "./Privacy";
import AcceptableUse from "./AcceptableUse";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);

// One string per paragraph, list item, heading or cell, so a sentence never runs into the next block.
function guideText(slug: string): string[] {
  const { Content, faqs, sections } = guides[slug];
  renderPage(<Content />);
  const blocks = [...document.querySelectorAll("p, li, h2, h3, h4, td, th")].map((e) => e.textContent ?? "");
  cleanup();
  return [...blocks, ...faqs.flatMap((f) => [f.q, f.a]), ...sections.map((s) => s.title)];
}
// The four older posts are typed inline in BlogPost.tsx, which does not export them: read the source and drop the tags.
const inlinePosts = () => read("src/pages/BlogPost.tsx").replace(/<\/(p|li|h\d)>/g, "\n\n").replace(/<[^<>\n]*>/g, "").split(/\n\n+/);

const SOURCES: Array<[string, () => string[]]> = [
  ...Object.keys(guides).map((slug): [string, () => string[]] => [slug, () => guideText(slug)]),
  ["BlogPost.tsx", inlinePosts],
  ["blogPosts.json", () => blogPosts.flatMap((p) => [p.title, p.excerpt])],
];

const OURS = /MyPrivacyTOOL|\bwe\b|\bour\b/i;
const REMOVAL_OR_MONITORING = /removal service|paid removal|monitoring (alerts|can|will)|offer (paid )?monitoring|sends? (removal )?requests|handles? the submissions|automates?\b|can be automated/i;
const NOT_YET = /when paid plans open|not available today|not (yet )?live|planned/i;
const OUR_SCAN = /free (exposure |privacy )?scan|\bthe scan\b|\bweb scan\b|MyPrivacyTOOL scan/i;
const BEYOND_THE_SCAN = /data[- ]brokers?\b|broker (sites|listings)|people-search|public records|breach|leaked|where your (details|data|information|card)|card (info|information|data|details)/i;
const SAYS_NOT = /does not|doesn't|cannot|not checked|only when/i;

const removalOffences = (t: string) => sentences(t).filter((s) => OURS.test(s) && REMOVAL_OR_MONITORING.test(s) && !NOT_YET.test(s));
const scanOffences = (t: string) => sentences(t).filter((s) => OUR_SCAN.test(s) && BEYOND_THE_SCAN.test(s) && !SAYS_NOT.test(s));

describe("blog copy: removal and monitoring are never present tense before they are live", () => {
  it.each(SOURCES)("%s", (_n, get) => {
    if (FEATURE_STATUS.F4 === "live" && FEATURE_STATUS.F5 === "live") return;
    expect(get().flatMap(removalOffences)).toEqual([]);
  });
  it("the rule catches the old wording", () => {
    for (const s of [
      "Remove your data from each broker (MyPrivacyTOOL's removal service automates this).",
      "MyPrivacyTOOL's removal service handles this automatically.",
      "After your scan, choose which brokers to remove from and we handle the submissions.",
      "If you would rather not run the searches yourself, MyPrivacyTOOL's free scan shows where your details appear, and monitoring can flag when they show up again.",
      "At MyPrivacyTOOL, the free scan shows where your data is exposed, and removal requests can be automated once you know what needs to go.",
    ]) expect(removalOffences(s), s).toHaveLength(1);
  });
});

describe("blog copy: the free scan is never said to search brokers, public records or breaches", () => {
  it.each(SOURCES)("%s", (_n, get) => {
    expect(get().flatMap(scanOffences)).toEqual([]);
  });
  it("the rule catches the old wording", () => {
    for (const s of [
      "Run a free MyPrivacyTOOL scan to see which data brokers have your name, phone, address and payment info.",
      "A free scan can show where your details appear across data-broker and people-search sites, so you know which requests are worth your time.",
      "You can run a free scan with MyPrivacyTOOL to check where your phone number and email may appear in broker listings and public sources.",
      "Enter your details and the free scan checks data brokers for your information.",
      "If you would like a quick view of where your details are exposed before you begin, you can run a free scan with MyPrivacyTOOL.",
    ]) expect(scanOffences(s), s).toHaveLength(1);
  });
  it("blog data and inline posts do not bring back the old claims", () => {
    const all = [read("src/data/blogPosts.json"), read("src/pages/BlogPost.tsx"), ...Object.keys(guides).flatMap(guideText)].join("\n");
    expect(all).not.toMatch(/exposing your personal data right now|personal information is currently exposed|54 ways your data is exposed|might already be selling|with an evidence link/i);
  });
});

// Local-only and nothing-is-sent claims about our product do not belong in the blog or in anything a Worker sends: pressing Scan me
// sends lookups to our Workers (see legalAccuracy.test.tsx, "what leaves the browser").
const NOTHING_LEAVES = /100% local|nothing (is |was )?(ever )?(sent|transmitted) (to|off|externally)|never leaves your (browser|device)|no data (is )?(ever )?sent/i;
const WORKER_COPY = [
  "workers/scan-report/lib/accounts.js",
  "workers/scan-report/lib/reportHex.js",
  "workers/scan-report/lib/email.js",
  "workers/scan-report/lib/freeRecord.js",
  "workers/scan-report/lib/followup.js",
  "workers/mpt-leads/worker.js",
  "workers/social-listeners/src/mirror-bot.ts",
  "workers/social-listeners/src/reply.ts",
  "locales/en/main.json",
];

describe("worker copy", () => {
  it.each([...WORKER_COPY, "src/data/blogPosts.json", "src/pages/BlogPost.tsx"])("%s has no local-only claim", (f) => {
    expect(read(f)).not.toMatch(NOTHING_LEAVES);
  });
  it("account errors name paid plans only as not open yet", () => {
    if (FEATURE_STATUS.F3 === "live") return;
    const errors = [...read("workers/scan-report/lib/accounts.js").matchAll(/error: '([^']*paid plan[^']*)'/gi)].map((m) => m[1]);
    expect(errors).toHaveLength(3);
    for (const e of errors) expect(e).toMatch(/When paid plans open/);
  });
  it("the report email does not present breach lookups as a feature on sale", () => {
    if (FEATURE_STATUS.F5 === "live") return;
    const src = read("workers/scan-report/lib/reportHex.js");
    expect(src).not.toMatch(/breach lookups are a paid feature/i);
    expect(src.match(/Breach lookups are not available today; we plan to include them when paid plans open\./g)).toHaveLength(2);
  });
  it("the signup email promises no scan or report and claims no broker or AI-dataset search", () => {
    const src = read("workers/mpt-leads/worker.js");
    expect(src).not.toMatch(/46 data categories|scan is being prepared|preparing your free privacy|with your full report/i);
    expect(src).toMatch(/It does not search data brokers or AI training datasets\./);
  });
});

// locales/ holds only the Telegram bot strings. The nine non-English files are empty (the bot falls back to English), so there is no
// translated claim to be false. A translation of the two strings about what we see and keep needs its own truth check first.
describe("locales: bot strings that make claims", () => {
  const load = (l: string) => JSON.parse(read(`locales/${l}/main.json`)) as Record<string, string>;
  it("English says data brokers are not searched", () => {
    expect(load("en")["bot.first_hexagon.brokers"]).toMatch(/not searched yet/);
  });
  it.each(["ja", "zh", "ko", "vi", "es", "de", "fr", "pt", "ar"])("%s: the what-we-see and what-we-keep strings are untranslated", (l) => {
    const d = load(l);
    expect([d["bot.first_hexagon.location"], d["bot.first_hexagon.question"]], "add a truth check for this language before shipping the translation").toEqual(["", ""]);
  });
});

// Saved scan results are deleted 12 months after the scan, account or not (mpt_purge_expired_web_scans, migration 20261011220000; the account
// history hides older scans too). So nothing may say a kept or linked scan stays until the person removes it, or that it holds no IP address.
describe("retention of kept and account-linked scans", () => {
  const privacy = () => {
    renderPage(<Privacy />);
    return (document.body.textContent ?? "").replace(/\s+/g, " ");
  };
  it("/privacy gives the 12-month limit wherever it says how long a linked or kept scan stays", () => {
    const t = privacy();
    expect(t).toMatch(/A linked scan's saved result is also deleted automatically 12 months after the scan\./);
    expect(t).toMatch(/kept until you delete the account or the scan, and its saved result is deleted automatically 12 months after the scan\./);
    expect(t).toMatch(/A saved scan result is different: it is deleted automatically 12 months after the scan\. It includes the technical details your browser reported, such as your IP address\./);
    expect(t).not.toMatch(/We do not store your IP address in it/);
    expect(t).not.toMatch(/keeps the scans you choose to keep in your account until you delete it/);
    expect(t).toMatch(/a saved scan result is deleted 12 months after the scan/);
  });
  it("the Keep page and the countdown email say the 12-month limit too", () => {
    const src = read("workers/scan-report/lib/freeRecord.js");
    expect(src).not.toMatch(/If you keep it, we do not delete your scan and/);
    expect(src).toMatch(/A saved scan result is still deleted automatically 12 months after the scan\./);
    expect(src).toMatch(/A saved scan result is deleted 12 months after the scan either way\./);
  });
  it("every FAQ sentence about paid plans says they are not open", () => {
    if (FEATURE_STATUS.F3 === "live") return;
    const hits = FAQS.flatMap((f) => sentences(f.a)).filter((s) => /paid plans/i.test(s) && !/when paid plans (open|are open)|not (yet )?open|not open|planned|not (live|available)/i.test(s));
    expect(hits).toEqual([]);
  });
});

describe("/acceptable-use: breach checks and monitoring are not presented as live", () => {
  it("says breaches are not checked today and names no live email-breach provider", () => {
    if (FEATURE_STATUS.F5 === "live") return;
    renderPage(<AcceptableUse />);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("We do not currently check whether an email address appears in known data breaches");
    expect(text).not.toMatch(/scanning and monitoring service|exposure across known data breaches|Have I Been Pwned API for breach data/);
  });
});
