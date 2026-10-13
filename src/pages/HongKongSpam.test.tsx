// MPC-7446: /HongKongSpam landing page. IVR_VERIFIED is false, so the public view must never list keys or claim
// auto-send; only an internal preview shows the placeholders, under an "unverified" banner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";

const flags = vi.hoisted(() => ({ preview: false, enabled: true, hk: true }));

vi.mock("@/config/hkSpamPage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/hkSpamPage")>()),
  isHkSpamPreview: () => flags.preview,
}));

vi.mock("@/config/hkDnc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/hkDnc")>()),
  get HK_SPAM_ENABLED() {
    return flags.enabled;
  },
}));

// The geo lookup is its own module (MPC-7450); the page tests decide the answer so fetch counts stay exact.
vi.mock("@/lib/hkVisitor", () => ({
  isHongKongVisitor: async () => flags.hk,
  hasHongKongOverride: () => false,
  setHongKongOverride: vi.fn(),
}));

import HongKongSpam from "./HongKongSpam";
import { REGISTRATIONS_ENDPOINT } from "@/lib/hkSpamRegister";
import { HK_SPAM_EVENTS } from "@/lib/hkSpamTrack";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const ROUTE = "/HongKongSpam";

let gtag: ReturnType<typeof vi.fn>;
const events = () => gtag.mock.calls.filter((c) => c[0] === "event").map((c) => c[1] as string);
const paramsOf = (name: string) => gtag.mock.calls.find((c) => c[0] === "event" && c[1] === name)?.[2] as Record<string, unknown>;

const setUa = (ua: string) => vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
const renderEn = (route = ROUTE) => renderPage(<HongKongSpam />, route);
const dialLink = () => screen.getByTestId("hk-dial") as HTMLAnchorElement;
const stubFetch = (ok = true) => {
  const f = vi.fn(async () => ({ ok, status: ok ? 201 : 401 }) as Response);
  vi.stubGlobal("fetch", f);
  return f;
};
const noNavigate = (el: HTMLElement) => el.addEventListener("click", (e) => e.preventDefault());

beforeEach(() => {
  flags.preview = false;
  flags.enabled = true;
  flags.hk = true;
  localStorage.clear();
  sessionStorage.clear();
  gtag = vi.fn();
  window.gtag = gtag;
  setUa(IPHONE);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T06:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  window.history.pushState({}, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.gtag;
});

describe("hero, CTA and steps", () => {
  it("shows the headline, one big tel: button and 4 numbered steps", () => {
    renderEn();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/stop spam calls and sms/i);
    expect(dialLink()).toHaveTextContent("Stop spam to this phone");
    expect(dialLink().getAttribute("href")).toMatch(/^tel:/);
    expect(document.querySelectorAll("ol > li")).toHaveLength(4);
  });

  it("PUBLIC while unverified: bare number, no keys, no auto-key or 'works' claim, no unverified banner", () => {
    setUa(ANDROID);
    renderEn();
    expect(dialLink().getAttribute("href")).toBe("tel:13571835000");
    expect(screen.queryByTestId("hk-keys")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hk-unverified")).not.toBeInTheDocument();
    expect(screen.getByText("Follow the spoken menu")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/automatic|sends? the keys|auto-?dial/i);
  });

  it("PREVIEW on iPhone: large manual keys plus the unverified banner", () => {
    flags.preview = true;
    renderEn();
    expect(screen.getByTestId("hk-unverified")).toHaveTextContent(/UNVERIFIED/);
    expect(dialLink().getAttribute("href")).toBe("tel:13571835000");
    expect(within(screen.getByTestId("hk-keys")).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("Press the keys shown")).toBeInTheDocument();
  });

  it("PREVIEW on Android: dial string carries the pauses and keys, still flagged unverified", () => {
    flags.preview = true;
    setUa(ANDROID);
    renderEn();
    expect(dialLink().getAttribute("href")).toMatch(/^tel:13571835000,+\d/);
    expect(screen.getByTestId("hk-unverified")).toBeInTheDocument();
    expect(screen.getByText("Watch the keys")).toBeInTheDocument();
  });

  it("tells desktop visitors to open the page on their phone", () => {
    setUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36");
    renderEn();
    expect(screen.getByText(/open this page on the phone/i)).toBeInTheDocument();
  });
});

describe("language", () => {
  it("toggles to Traditional Chinese, remembers it and tracks the switch", async () => {
    const user = userEvent.setup();
    renderEn();
    await user.click(screen.getByRole("button", { name: "Switch to Traditional Chinese" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("一鍵拒收香港垃圾來電及短訊");
    expect(localStorage.getItem("mpt_hk_lang")).toBe("zh");
    expect(paramsOf("hk_spam_lang_switch")).toMatchObject({ from: "en", to: "zh" });
    await user.click(screen.getByRole("button", { name: "切換至英文" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/stop spam calls/i);
  });

  it("auto-selects Chinese from ?lang=zh", () => {
    window.history.pushState({}, "", `${ROUTE}?lang=zh`);
    renderEn();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("一鍵拒收香港垃圾來電及短訊");
    expect(dialLink()).toHaveTextContent("停止這部手機收到垃圾訊息");
  });
});

describe("GA4", () => {
  it("fires hk_spam_view on load and hk_spam_dial_tap on the CTA without blocking the link", () => {
    renderEn();
    expect(events()).toContain("hk_spam_view");
    noNavigate(dialLink());
    fireEvent.click(dialLink());
    expect(events()).toContain("hk_spam_dial_tap");
    expect(paramsOf("hk_spam_dial_tap")).toMatchObject({ platform: "ios", keys_shown: false });
  });

  it("carries the UTM source through to events", () => {
    sessionStorage.setItem("mpt_hk_utm", JSON.stringify({ utm_source: "facebook" }));
    renderEn();
    expect(paramsOf("hk_spam_view")).toMatchObject({ utm_source: "facebook" });
  });

  it("every event the page can send is one of the 8 documented events", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderEn();
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    await screen.findByTestId("hk-result");
    for (const e of events()) expect(HK_SPAM_EVENTS as readonly string[]).toContain(e);
  });
});

describe("Done: protection date and the one Supabase insert", () => {
  it("computes the date, inserts ONE row (return=minimal, no phone) and tracks hk_spam_registered", async () => {
    const f = stubFetch();
    const user = userEvent.setup();
    sessionStorage.setItem("mpt_hk_utm", JSON.stringify({ utm_source: "fb" }));
    renderEn();
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    const result = await screen.findByTestId("hk-result");
    expect(result).toHaveTextContent("2026");
    expect(result).toHaveTextContent("23");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(REGISTRATIONS_ENDPOINT);
    expect((init.headers as Record<string, string>).Prefer).toBe("return=minimal");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ protection_date: "2026-10-23", platform: "ios", language: "en", utm_source: "fb", email: null, reminder_consent: false });
    expect(Object.keys(body).some((k) => /phone|number|msisdn/i.test(k))).toBe(false);
    expect(events()).toContain("hk_spam_registered");
    expect(events()).not.toContain("hk_spam_email_submit");
    expect(localStorage.getItem("mpt_hk_registered")).toBe("2026-10-23");
    // the Done form is replaced by the result, so a second tap cannot insert a second row
    expect(screen.queryByRole("button", { name: /done: i have registered/i })).not.toBeInTheDocument();
  });

  it("stores the email only with consent, in the same single insert, and tracks hk_spam_email_submit", async () => {
    const f = stubFetch();
    const user = userEvent.setup();
    renderEn();
    await user.type(screen.getByLabelText(/email me when i am protected/i), "me@example.com");
    // MPC-7538: the reminder box is ticked for them once they type an email; the privacy-tips box is not
    expect(screen.getByRole("checkbox", { name: "Send me the reminder" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    await screen.findByTestId("hk-result");
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ email: "me@example.com", reminder_consent: true, marketing_consent: false });
    expect(events()).toContain("hk_spam_email_submit");
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("me@example.com");
    expect(screen.getByText(/reminder saved/i)).toBeInTheDocument();
  });

  it("shows the consent line, links it to the policy section, and has two separate boxes (MPC-7538)", async () => {
    const user = userEvent.setup();
    renderEn();
    const line = screen.getByTestId("hk-consent-line");
    expect(line).toHaveTextContent("We collect your email, your registration date, your phone type (Android, iPhone or other) and your language. We never collect your phone number.");
    expect(line).toHaveTextContent("one reminder on the day your protection starts");
    expect(line).toHaveTextContent("unsubscribe");
    expect(within(line).getByRole("link", { name: "How we handle your data" })).toHaveAttribute("href", "/privacy#hk-stop-spam");
    expect(screen.queryByRole("checkbox", { name: "Send me the reminder" })).not.toBeInTheDocument(); // the consent boxes appear once an email is typed
    await user.type(screen.getByLabelText(/email me when i am protected/i), "a");
    expect(screen.getByRole("checkbox", { name: "Send me the reminder" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Send me MyPrivacyTOOL privacy tips/ })).not.toBeChecked();
  });

  it("stores marketing_consent only when the privacy-tips box is ticked on its own", async () => {
    const f = stubFetch();
    const user = userEvent.setup();
    renderEn();
    await user.type(screen.getByLabelText(/email me when i am protected/i), "me@example.com");
    await user.click(screen.getByRole("checkbox", { name: /Send me MyPrivacyTOOL privacy tips/ }));
    await user.click(screen.getByRole("checkbox", { name: "Send me the reminder" })); // untick the reminder
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    await screen.findByTestId("hk-result");
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ email: "me@example.com", reminder_consent: false, marketing_consent: true });
    expect(screen.queryByText(/reminder saved/i)).not.toBeInTheDocument();
  });

  it("shows the Chinese consent line, link and boxes with ?lang=zh", async () => {
    window.history.pushState({}, "", `${ROUTE}?lang=zh`);
    const user = userEvent.setup();
    renderEn();
    const line = screen.getByTestId("hk-consent-line");
    expect(line).toHaveTextContent("但絕不收集你的電話號碼");
    expect(within(line).getByRole("link", { name: "我們如何處理你的資料" })).toHaveAttribute("href", "/privacy#hk-stop-spam-zh");
    await user.type(screen.getByLabelText(/保障生效時以電郵通知我/), "a");
    expect(screen.getByRole("checkbox", { name: "請發送提醒給我" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /請向我發送 MyPrivacyTOOL 私隱貼士/ })).not.toBeChecked();
  });

  it("blocks an email with both boxes unticked, and an invalid email, without calling the network", async () => {
    const f = stubFetch();
    const user = userEvent.setup();
    renderEn();
    const input = screen.getByLabelText(/email me when i am protected/i);
    await user.type(input, "me@example.com");
    await user.click(screen.getByRole("checkbox", { name: "Send me the reminder" })); // untick
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/tick a box/i);
    await user.clear(input);
    await user.type(input, "not-an-email");
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not look right/i);
    expect(f).not.toHaveBeenCalled();
  });

  it("still shows the date when the save fails", async () => {
    stubFetch(false);
    const user = userEvent.setup();
    renderEn();
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    const result = await screen.findByTestId("hk-result");
    expect(result).toHaveTextContent("2026");
    expect(result).toHaveTextContent(/could not save your reminder/i);
  });

  it("refuses to guess a date outside the holiday table", async () => {
    vi.setSystemTime(new Date("2031-06-01T00:00:00Z"));
    const f = stubFetch();
    const user = userEvent.setup();
    renderEn();
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not work out the date/i);
    expect(f).not.toHaveBeenCalled();
  });

  it("shows a returning visitor's remembered date without inserting again", () => {
    localStorage.setItem("mpt_hk_registered", "2026-10-23");
    const f = stubFetch();
    renderEn();
    expect(screen.getByTestId("hk-result")).toHaveTextContent("2026");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("scan CTA, opt-out generator, spam log, FAQ, disclaimer", () => {
  it("links to the free scan with the UTM carried and tracks hk_spam_scan_click", () => {
    renderEn();
    const link = screen.getByRole("link", { name: "Run the free privacy scan" });
    expect(link.getAttribute("href")).toBe("/scan?utm_source=hongkongspam");
    noNavigate(link);
    fireEvent.click(link);
    expect(events()).toContain("hk_spam_scan_click");
  });

  it("ticks generic sender types, writes one copy-paste message each and tracks hk_spam_optout_generated without any names", async () => {
    const user = userEvent.setup();
    renderEn();
    for (const label of ["Banks", "Phone and mobile companies", "Shops and retailers", "Loyalty and rewards schemes"]) {
      expect(screen.getByRole("checkbox", { name: label })).not.toBeChecked();
    }
    await user.click(screen.getByRole("button", { name: "Write my opt-out messages" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/tick at least one/i);
    expect(events()).not.toContain("hk_spam_optout_generated");
    await user.click(screen.getByRole("checkbox", { name: "Banks" }));
    await user.click(screen.getByRole("checkbox", { name: "Loyalty and rewards schemes" }));
    await user.selectOptions(screen.getByLabelText("Send it by"), "email");
    await user.click(screen.getByRole("button", { name: "Write my opt-out messages" }));
    const bank = screen.getByLabelText(/message for banks/i) as HTMLTextAreaElement;
    expect(bank.value.startsWith("Subject:")).toBe(true);
    expect(bank.value).toContain("my bank");
    expect(screen.getByLabelText(/message for loyalty/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/message for shops/i)).not.toBeInTheDocument();
    expect(paramsOf("hk_spam_optout_generated")).toMatchObject({ channel: "email", language: "en", sender_types: 2 });
  });

  it("logs spam on this device only, tracks hk_spam_log_added, and can remove and clear", async () => {
    const f = stubFetch();
    const user = userEvent.setup();
    renderEn();
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to log" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Type"), "recorded");
    await user.type(screen.getByLabelText("Number"), "+852 5555 0000");
    await user.click(screen.getByRole("button", { name: "Add to log" }));
    const list = screen.getByTestId("hk-log-list");
    expect(within(list).getByText(/\+852 5555 0000/)).toBeInTheDocument();
    expect(within(list).getByText("Recorded call")).toBeInTheDocument();
    expect(screen.getByTestId("hk-log-export")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("mpt_hk_spam_log") as string)).toHaveLength(1);
    expect(events()).toContain("hk_spam_log_added");
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("5555");
    expect(f).not.toHaveBeenCalled(); // the log never leaves the device
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Number"), "x");
    await user.click(screen.getByRole("button", { name: "Add to log" }));
    await user.click(screen.getByRole("button", { name: "Clear log" }));
    expect(JSON.parse(localStorage.getItem("mpt_hk_spam_log") as string)).toEqual([]);
  });

  it("has the OFCA-based FAQ and a not-OFCA disclaimer linking dnc.gov.hk", () => {
    renderEn();
    for (const q of [/is registering free/i, /when am i protected/i, /why do companies i know still message me/i, /live telemarketers/i, /check or cancel/i]) {
      expect(screen.getByText(q)).toBeInTheDocument();
    }
    const disclaimer = screen.getByTestId("hk-disclaimer");
    expect(disclaimer).toHaveTextContent(/is not OFCA/i);
    const link = within(disclaimer).getByRole("link", { name: "dnc.gov.hk" });
    expect(link.getAttribute("href")).toBe("https://www.dnc.gov.hk");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("SEO head and routing", () => {
  it("is noindex while the launch flag is off, with canonical, hreflang and FAQPage + HowTo JSON-LD", async () => {
    renderEn();
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull());
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://www.myprivacytool.io/HongKongSpam");
    expect(document.head.querySelector('link[rel="alternate"][hreflang="en-HK"]')).not.toBeNull();
    expect(document.head.querySelector('link[rel="alternate"][hreflang="zh-HK"]')?.getAttribute("href")).toContain("?lang=zh");
    expect(document.head.querySelector('meta[property="og:title"]')).not.toBeNull();
    expect(document.head.querySelector('meta[name="twitter:card"]')).not.toBeNull();
    const types = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "{}")["@type"]);
    expect(types).toEqual(expect.arrayContaining(["FAQPage", "HowTo"]));
    expect(document.title).toMatch(/Hong Kong Spam/);
  });

  it("redirects lowercase and other variants to /HongKongSpam", () => {
    window.history.pushState({}, "", `${ROUTE}?lang=zh`);
    renderEn("/hongkongspam");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("一鍵拒收香港垃圾來電及短訊");
  });
});

describe("Done screen extras: consent placeholder and 'Didn't work?'", () => {
  it("shows the real consent wording, with no placeholder tag (MPC-7538)", async () => {
    const user = userEvent.setup();
    renderEn();
    await user.type(screen.getByLabelText(/email me when i am protected/i), "me@example.com");
    expect(screen.queryByTestId("hk-consent-placeholder")).not.toBeInTheDocument();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("hk-consent-line")).toHaveTextContent("We never collect your phone number.");
  });

  it("shows 'You're protected from [date]' and a Didn't work? link to /contact with platform and language", async () => {
    stubFetch();
    setUa(ANDROID);
    const user = userEvent.setup();
    renderEn();
    await user.click(screen.getByRole("button", { name: /done: i have registered/i }));
    const result = await screen.findByTestId("hk-result");
    expect(result).toHaveTextContent(/you're protected from .*23 October 2026/i);
    const href = screen.getByTestId("hk-didnt-work").getAttribute("href") as string;
    expect(href.startsWith("/contact?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({ source: "hk-spam", platform: "android", lang: "en" });
  });

  it("attaches the Chinese language code when the page is in Traditional Chinese", async () => {
    stubFetch();
    window.history.pushState({}, "", `${ROUTE}?lang=zh`);
    const user = userEvent.setup();
    renderEn();
    await user.click(screen.getByRole("button", { name: /完成，我已登記/ }));
    await screen.findByTestId("hk-result");
    expect(screen.getByTestId("hk-didnt-work").getAttribute("href")).toContain("lang=zh");
    expect(screen.getByTestId("hk-didnt-work")).toHaveTextContent("不成功？");
  });
});

describe("Hong Kong only and the kill switch", () => {
  it("non-HK visitors see a short 'for Hong Kong numbers' note; HK visitors do not", async () => {
    flags.hk = false;
    renderEn();
    expect(await screen.findByTestId("hk-nonhk-note")).toHaveTextContent(/for hong kong numbers/i);
    cleanup();
    flags.hk = true;
    renderEn();
    await waitFor(() => expect(screen.getByTestId("hk-dial")).toBeInTheDocument());
    expect(screen.queryByTestId("hk-nonhk-note")).not.toBeInTheDocument();
  });

  it("override button hides the note", async () => {
    flags.hk = false;
    const user = userEvent.setup();
    renderEn();
    await user.click(await screen.findByRole("button", { name: "I have a Hong Kong number" }));
    expect(screen.queryByTestId("hk-nonhk-note")).not.toBeInTheDocument();
  });

  it("HK_SPAM_ENABLED=false hides the page entirely (sent to the homepage) and sends no event", () => {
    flags.enabled = false;
    renderEn();
    expect(screen.queryByTestId("hk-dial")).not.toBeInTheDocument();
    expect(events()).toEqual([]);
  });
});
