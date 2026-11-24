// MPC-9828 (F8): a legal page must be true on the day it is read. Until F3 (accounts and Stripe billing) is live, no legal page may
// state Stripe, accounts, billing, cancellation or refunds as a present fact; and no legal page carries a status marker.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderPage } from "@/test/render";
import { FEATURE_STATUS } from "@/config/featureStatus";
import Privacy from "./Privacy";
import Cookies from "./Cookies";
import Terms from "./Terms";
import DPA from "./DPA";
import AcceptableUse from "./AcceptableUse";

const PAGES: Array<[string, () => JSX.Element]> = [
  ["/privacy", () => <Privacy />],
  ["/cookies", () => <Cookies />],
  ["/terms", () => <Terms />],
  ["/dpa", () => <DPA />],
  ["/acceptable-use", () => <AcceptableUse />],
];
// vitest runs in mode "test", which does not load .env.production, so read the production switch from the file itself.
const ACCOUNTS_LIVE = /^VITE_ACCOUNTS_ENABLED=true\s*$/m.test(readFileSync(resolve(process.cwd(), ".env.production"), "utf8"));
const NO_ACCOUNTS = /(we|there) (do not|don't|have no|are no)[^.]{0,40}(user )?accounts?( today)?|no accounts? today|account data:? we hold none|no account to cancel/i;
const FUTURE = /when paid plans open|before paid plans go live|planned|expect|not (yet )?open|not available today|none of it applies today|we hold none today|we do not have user accounts/i;
const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=\.)\s+/);

describe("legal pages: Stripe and billing are never present tense before F3 is live", () => {
  const live = FEATURE_STATUS.F3 === "live";
  it.each(PAGES)("%s names Stripe only in future or planned wording", (_p, el) => {
    if (live) return;
    renderPage(el());
    const text = document.body.textContent ?? "";
    for (const s of sentences(text).filter((x) => /stripe/i.test(x))) {
      expect(s, `present-tense Stripe: "${s}"`).toMatch(FUTURE);
    }
  });

  it("/cookies lists no Stripe cookie", () => {
    if (live) return;
    renderPage(<Cookies />);
    const li = [...document.querySelectorAll("li")].map((e) => e.textContent ?? "");
    expect(li.filter((t) => /stripe/i.test(t))).toEqual([]);
  });

  it("/terms does not describe billing, cancellation in account settings or a 14-day refund as live", () => {
    if (live) return;
    renderPage(<Terms />);
    const t = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).not.toMatch(/account settings/i);
    expect(t).not.toMatch(/14 days of purchase/i);
    expect(t).not.toMatch(/renews automatically/i);
    expect(t).not.toMatch(/we charge the payment method on file/i);
    expect(t).toContain("Paid plans are not open today.");
  });

  it("/privacy does not list payment or account data as held today, and names the planned vendor as not active", () => {
    if (live) return;
    renderPage(<Privacy />);
    const t = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).not.toMatch(/Retained for the duration of your subscription/i);
    expect(t).not.toMatch(/Billing address, payment method/i);
    expect(t).toContain("Partners We Are Considering");
    expect(t).toMatch(/planned and not yet active/);
  });

  it.each(["/terms", "/cookies", "/privacy", "/dpa"] as const)("%s carries no FeatureStatus marker (MPC-9894: legal text is true today, no markers)", (p) => {
    renderPage(p === "/terms" ? <Terms /> : p === "/cookies" ? <Cookies /> : p === "/privacy" ? <Privacy /> : <DPA />);
    const marks = [...document.querySelectorAll("[data-feature-status]")].map((e) => e.getAttribute("data-feature"));
    expect(marks).toEqual([]);
  });
});

// MPC-9913 (ledger C21): while free accounts are live, no legal page may say there are no accounts or no account data.
describe("legal pages: never say there are no accounts while free accounts are live", () => {
  it.each(PAGES)("%s has no no-accounts sentence", (_p, el) => {
    if (!ACCOUNTS_LIVE) return;
    renderPage(el());
    const hits = sentences(document.body.textContent ?? "").filter((x) => NO_ACCOUNTS.test(x));
    expect(hits, `no-accounts sentence: "${hits[0]}"`).toEqual([]);
  });
  it("the pattern catches the old wording", () => {
    for (const s of ["We have no accounts today.", "There are no user accounts today; the free scan needs none.", "We do not have user accounts today.", "Account Data: We hold none today.", "There is no subscription and no account to cancel."]) {
      expect(NO_ACCOUNTS.test(s), s).toBe(true);
    }
  });
});

// MPC-11242 (F8 pass 2, MPC-9907): the storage sentence is one constant used by the home page and /thank-you, and the
// Hong Kong Stop Spam policy section (English and Chinese) obeys the same tense rules and matches the retention job.
import ThankYou from "./ThankYou";
import { STORAGE_NOTE, RESULT_PRIVACY_NOTE } from "@/data/trustCopy";
import { FAQS } from "@/data/faqs";
import { HK_POLICY_EN, HK_POLICY_ZH, HK_RETENTION_DAYS } from "@/data/hkSpamCopy";

describe("storage sentence: home page and /thank-you say the same thing", () => {
  it("/thank-you renders the shared sentence word for word", () => {
    renderPage(<ThankYou />);
    expect((document.body.textContent ?? "").replace(/\s+/g, " ")).toContain(STORAGE_NOTE);
  });
  it("the home page renders it from the same constant, not a typed copy", () => {
    const src = readFileSync(resolve(process.cwd(), "src/pages/Index.tsx"), "utf8");
    expect(src).toContain("{STORAGE_NOTE}");
    expect(src).not.toMatch(/keep it for 12 months/);
  });
  it("says nothing false: no 'not stored on our servers' claim", () => {
    expect(STORAGE_NOTE).not.toMatch(/aren't stored|not stored on our servers/i);
    expect(STORAGE_NOTE).toMatch(/12 months/);
  });
});

describe("HK Stop Spam policy copy (en and zh-HK)", () => {
  const flat = (c: typeof HK_POLICY_EN) => [c.title, c.intro, ...c.blocks.flatMap((b) => [b.heading, ...(b.paragraphs ?? []), ...(b.bullets ?? [])])].join(" ");
  it.each([["en", HK_POLICY_EN], ["zh", HK_POLICY_ZH]] as const)("%s: no Stripe, billing, account or refund claim and no status marker", (_l, c) => {
    const t = flat(c);
    expect(t).not.toMatch(/stripe|billing|subscription|refund|renews|帳戶|退款|付款|收費|扣款/i);
    expect(t).not.toMatch(/\b(planned|coming soon|beta)\b|即將推出|計劃中/i);
  });
  it.each([["en", HK_POLICY_EN], ["zh", HK_POLICY_ZH]] as const)("%s: the 15.3 retention block states the %s-day period the daily purge job uses", (_l, c) => {
    const b = c.blocks.find((x) => /^15\.3/.test(x.heading));
    expect(b, "15.3 block").toBeTruthy();
    expect((b?.paragraphs ?? []).join(" ")).toContain(String(HK_RETENTION_DAYS));
    expect(HK_RETENTION_DAYS).toBe(90); // supabase/migrations/20261013000000_mpc_7538_hk_spam_consent_and_retention.sql: hk_spam_retention.days = 90
  });
});

// MPC-9907 (F8 pass 2, items 1 and 2): what leaves the browser. Pressing Scan me sends a consent record to our Worker, the IP and location
// come from our own /whoami lookup, and the WebRTC leak check asks an outside STUN service for the public address. So no page or panel may
// say nothing leaves the browser. The scan RESULT does stay in the browser unless the visitor saves it, and that is still said.
const NOTHING_LEAVES = /(no|nothing)[^.]{0,40}(is |was |ever )?(sent|transmitted)[^.]{0,30}(any|to our|externally)|never (sent|leaves)[^.]{0,20}(servers|your device)|100% (local|privacy)|no api calls|no data storage/i;

describe("what leaves the browser (MPC-9907)", () => {
  const faq = (q: string) => (FAQS.find((f) => f.q === q)?.a ?? "").replace(/\s+/g, " ");
  it("Privacy 2.0 and 2.4 say the scan uses our servers and an outside service, and the result stays in the browser", () => {
    renderPage(<Privacy />);
    const t = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(t).toMatch(/Your IP address and approximate location come from a lookup on our own servers, which stores nothing/);
    expect(t).toMatch(/When you press Scan me, your browser sends us a record of your agreement/);
    expect(t).toMatch(/The finished result stays in your browser\. It is not sent to us unless you ask for your report/);
    expect(t).not.toMatch(/detects device, browser and network characteristics directly in your browser/);
    expect(t).not.toMatch(/If you leave without giving (us )?an email address, nothing from the scan is saved/);
  });
  it("the two FAQ answers do not claim the scan never contacts a server", () => {
    const a = faq("Does the scan send my results to your servers?");
    expect(a).toMatch(/not sent to us unless you choose to save your scan/);
    expect(a).toMatch(/lookup on our own servers/);
    expect(a).toMatch(/outside service/);
    expect(a).not.toMatch(/does not send them to a server we operate/);
    const b = faq("How can I check the scan stays in my browser?");
    expect(b).toMatch(/requests to our servers|ones to our servers/);
    expect(b).not.toMatch(/watch which requests the page makes\. Our source/);
  });
  it("the results-page note keeps the pinned phrases and makes no nothing-is-sent claim", () => {
    expect(RESULT_PRIVACY_NOTE).toMatch(/or save your scan with your email/);
    expect(RESULT_PRIVACY_NOTE).toMatch(/We store your scan result only if you tick the save box with your email\./);
    expect(RESULT_PRIVACY_NOTE).toMatch(/lookup on our own servers/);
    expect(RESULT_PRIVACY_NOTE).not.toMatch(NOTHING_LEAVES);
  });
  it.each([
    "src/components/FinalSummaryPanel.tsx",
    "src/components/locale/PrivacyBanner.tsx",
    "src/components/LanguageIntelligencePanel.tsx",
    "src/components/SecurityPanel.tsx",
    "src/components/FederatedLearningModal.tsx",
  ])("%s carries no false local-only claim", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(src).not.toMatch(/100% Local|Nothing was transmitted|Nothing is transmitted unless|No data is (ever )?sent|No data is sent externally|never sent to servers|Only mathematical updates \(gradients\) are shared|No data collection|End-to-end privacy|No API calls|No data storage/);
  });
  it("VoiceDebugPanel's 'never leaves your device' stays true: it makes no network call", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/VoiceDebugPanel.tsx"), "utf8");
    expect(src).not.toMatch(/\bfetch\(|recipientFetch|sendBeacon|XMLHttpRequest|trackEvent|@\/lib\/analytics/);
  });
});
