// MPC-7561 (FAQ part): the approved FAQ is published, within its word limit, and the report email's FAQ link lands on a real, indexed page.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FAQS } from "./faqs";
import { buildReportEmail } from "../../workers/scan-report/lib/email.js";

const root = resolve(__dirname, "../..");
const words = (s: string) => s.trim().split(/\s+/).length;

describe("approved FAQ (MPC-7560 approved 2026-10-28)", () => {
  const APPROVED = [
    "What is in my privacy report?",
    'Why are some hexagons marked "not checked"?',
    'What does "estimate" mean?',
    "What do you check about my email address?",
    "What is my scan number?",
    "How do I delete my scan?",
    "Do you sell or share my data?",
    "What is the JSON file?",
    "Why did I get this email, and how do I stop them?",
    "Is MyPrivacyTOOL tracking me?",
    'What does "mirror, not tracker" mean?',
    "What do you record about bots and AI crawlers?",
    "What happens to my IP address?",
  ];

  it("publishes every approved question once", () => {
    for (const q of APPROVED) expect(FAQS.filter((f) => f.q === q), q).toHaveLength(1);
  });

  it("keeps each approved answer under 80 words", () => {
    for (const q of APPROVED) expect(words(FAQS.find((f) => f.q === q)!.a), q).toBeLessThan(80);
  });

  it("makes no promise the policy does not make (no 'open source', no self-service delete claim)", () => {
    const text = FAQS.map((f) => f.a).join(" ");
    expect(text).not.toMatch(/open[- ]source/i);
    expect(FAQS.find((f) => f.q === "How do I delete my scan?")!.a).toContain("no self-service delete button yet");
  });
});

describe("report email FAQ link", () => {
  const email = buildReportEmail({ scan: { id: "x", score: null, risk_level: null, partial: true, categories_checked: [] }, breaches: [], breachStatus: "not_checked", brokers: [], webScan: null, emailChecks: [] });

  it("is in both the HTML and the plain text", () => {
    expect(email.html).toContain("https://myprivacytool.io/faq");
    expect(email.text).toContain("https://myprivacytool.io/faq");
  });

  it("points at a real route and a page in the sitemap", () => {
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toMatch(/path="\/faq"/);
    const sitemap = readFileSync(resolve(root, "scripts/generate-sitemap.mjs"), "utf8");
    expect(sitemap).toContain('path: "/faq"');
  });
});
