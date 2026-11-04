// CK-7721 fix 5: the AI-provider disclosure is generic (any provider) and the DPA lists what is in use. Wording needs Chris's sign-off.
import { describe, it, expect } from "vitest";
import { renderPage } from "@/test/render";
import Privacy from "./Privacy";
import DPA from "./DPA";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("AI model providers disclosure", () => {
  it("Privacy Policy section 5 names the category, not one vendor, and says what is and is not sent", () => {
    renderPage(<Privacy />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("AI Model Providers:");
    expect(text).toContain("open-source or closed-source and from any country");
    expect(text).toContain("We remove email addresses and phone numbers from the text first");
    expect(text).toContain("The free scan on our website and Alice's spoken guidance do not send anything to an AI provider");
    expect(text).toContain("always named in the sub-processor list of our DPA");
  });

  it("the DPA sub-processor list names the AI provider in use and the transfer wording covers AI providers", () => {
    renderPage(<DPA />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("AI model providers (any provider; currently Alibaba Cloud, Qwen models)");
    expect(text).toContain("message text and short approved help-article excerpts, with email addresses and phone numbers removed first");
    expect(text).toContain("any country where one of our AI model providers runs its service");
  });
});
