// MPC-7470 (D12): the saved-scan wording of record. Changing it needs Chris's written approval.
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Privacy from "./Privacy";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Privacy: saved scan", () => {
  it("2.4 says a scan is saved only with the email and the box, for 12 months, and what is counted without personal data", () => {
    renderPage(<Privacy />);
    expect(screen.getByRole("heading", { name: "2.4 Your Saved Scan Result" })).toBeInTheDocument();
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain(
      "The free scan runs in your browser and shows you the results there. We do not save it unless you ask for your report. " +
        "When you enter your email address and tick the box to save your scan result, we save the full result, meaning the technical details your browser reported " +
        "such as IP address, device, browser, language, screen and fingerprint-style values, together with your email address, for 12 months, so your report can show it. " +
        "If you leave without giving an email address, nothing from the scan is saved. We only count, without personal data, how many visitors finish a scan and how many ask for a report, " +
        "through our analytics if you accepted analytics cookies.",
    );
  });

  it("2.0 and the retention line match; the old save-everything wording and the 90-day rule are gone", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("The finished result stays in your browser. It is not sent to us unless you ask for your report and choose to save it (see section 2.4).");
    expect(text).toContain("is kept for 12 months, then deleted automatically");
    expect(text).not.toMatch(/even if you never give us an email/i);
    expect(text).not.toMatch(/90 days after the scan/i);
    expect(text).not.toMatch(/accepted the consent banner, we also save/i);
  });

  it("keeps the email-check disclosure (Cloudflare: domain only; Gravatar: SHA-256 hash)", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("the domain part of your email address to Cloudflare");
    expect(text).toContain("a SHA-256 hash of your email address to Gravatar");
  });
});

// MPC-7494: the "Recognising your device" paragraph (docs/policy-wording-mpc-7491.md) goes live in the same flip as the feature (VITE_RECOGNITION_ENABLED).
describe("Privacy: recognising your device (MPC-7494)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is not shown while recognition is off, and third-party information stays 2.5", () => {
    renderPage(<Privacy />);
    expect(screen.queryByRole("heading", { name: "2.5 Recognising Your Device" })).toBeNull();
    expect(screen.getByRole("heading", { name: "2.5 Information from Third Parties" })).toBeInTheDocument();
    expect(flat(document.body.textContent ?? "")).not.toContain("Recognising your device");
  });
  it("is shown as 2.5 when recognition is on, with the approved wording, and third-party information becomes 2.6", () => {
    vi.stubEnv("VITE_RECOGNITION_ENABLED", "true");
    renderPage(<Privacy />);
    expect(screen.getByRole("heading", { name: "2.5 Recognising Your Device" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2.6 Information from Third Parties" })).toBeInTheDocument();
    expect(flat(document.body.textContent ?? "")).toContain(
      "If you choose to, we can tell you when we recognise the device you are using from the technical details its browser shows us, without using a cookie. " +
        "We do this in the open: when it happens we show you that we recognised you, which details we used and how, and what you can do about it, including asking us to delete it. " +
        "We do not recognise your device in the background. If you do nothing, we do not link a visit to you. Recognising a device is only used with your consent, " +
        "and you can withdraw it at any time by contacting us or deleting your scan number record.",
    );
  });
});

// MPC-7538: the HK Stop Spam section, English and Traditional Chinese. Wording is a draft for Chris (MPC-7545) and a lawyer.
describe("Privacy: HK Stop Spam section", () => {
  it("has an English and a Chinese section the consent line can link to", () => {
    renderPage(<Privacy />);
    expect(document.getElementById("hk-stop-spam")).toHaveAttribute("lang", "en");
    expect(document.getElementById("hk-stop-spam-zh")).toHaveAttribute("lang", "zh-HK");
    expect(screen.getByRole("heading", { name: "15. HK Stop Spam (Hong Kong Do-not-call page)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "15. 香港拒收垃圾訊息頁面（HK Stop Spam）" })).toBeInTheDocument();
  });

  it("covers data held, no phone numbers, purpose, 90-day retention with the marketing exception, PDPO rights and not-OFCA", () => {
    renderPage(<Privacy />);
    const en = flat(document.getElementById("hk-stop-spam")?.textContent ?? "");
    expect(en).toContain("We never ask for, receive or store your phone number.");
    expect(en).toContain("one reminder email on the day your protection starts");
    expect(en).toContain("We send no marketing email to anyone who has not ticked it.");
    expect(en).toContain("We delete your email address and the whole record 90 days after your protection date.");
    expect(en).toContain("The exception is if you ticked");
    expect(en).toContain("Personal Data (Privacy) Ordinance (PDPO)");
    expect(en).toContain("privacy@myprivacytool.io");
    expect(en).toContain("We are not OFCA");
    const zh = flat(document.getElementById("hk-stop-spam-zh")?.textContent ?? "");
    expect(zh).toContain("我們從不索取、接收或儲存你的電話號碼");
    expect(zh).toContain("90 日");
    expect(zh).toContain("《個人資料（私隱）條例》");
    expect(zh).toContain("我們不是通訊辦");
    expect(document.querySelector('#hk-stop-spam a[href="https://www.dnc.gov.hk"]')).not.toBeNull();
  });
});

// MPC-7645: the referral section follows the site switch (wording is a draft for Chris and a lawyer).
describe("Privacy: referral programme section", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is not shown while the programme is off", () => {
    renderPage(<Privacy />);
    expect(screen.queryByRole("heading", { name: "16. Inviting Friends (Referral Programme)" })).not.toBeInTheDocument();
  });

  it("when on, says what is kept, that invited addresses are hashed, no reminders, unsubscribe, and the 10-person cap", () => {
    vi.stubEnv("VITE_REFERRALS_ENABLED", "true");
    renderPage(<Privacy />);
    expect(screen.getByRole("heading", { name: "16. Inviting Friends (Referral Programme)" })).toBeInTheDocument();
    const t = flat(document.getElementById("referrals")?.textContent ?? "");
    expect(t).toContain("We keep only a SHA-256 hash of the address, never the address itself");
    expect(t).toContain("send no reminders");
    expect(t).toContain("unsubscribe link");
    expect(t).toContain("up to 10 people in total");
    expect(t).toContain("privacy@myprivacytool.io");
  });
});
