// CK-7721 part B: the FAQ carries the saved-scan exception (Privacy Policy 2.4 and 6) and four factual items.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Faq from "./Faq";
import ThankYou from "./ThankYou";
import { MemoryRouter } from "react-router-dom";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const EXCEPTION = "unless you choose to save your scan with your email, in which case we keep it for 12 months, then delete it automatically.";

describe("FAQ", () => {
  it("states the save exception in the 'send my results' answer", () => {
    renderPage(<Faq />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain(`does not send them to a server we operate, ${EXCEPTION}`);
  });

  it("has the four new items, using policy and code wording only", () => {
    renderPage(<Faq />);
    for (const q of ["What is a data broker?", "How can I check the scan stays in my browser?", "Who or what is Alice?", "What happens if I save my scan?"]) {
      expect(screen.getByText(q)).toBeInTheDocument();
    }
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("Network tab");
    expect(text).toContain("Our source code is public to read at https://github.com/MyPrivacyTOOL/myprivacytool");
    expect(text).toContain("read aloud by your own device's voice. There is no chat, and nothing you do with her voice is sent to us.");
    expect(text).toContain("kept for 12 months".replace("kept", "we keep it"));
    expect(text).toContain("write to privacy@myprivacytool.io");
    expect(text).not.toMatch(/open[- ]source/i);
  });
});

describe("Thank-you page trust line", () => {
  it("carries the save exception", () => {
    render(
      <MemoryRouter initialEntries={["/thank-you?source=contact"]}>
        <ThankYou />
      </MemoryRouter>,
    );
    expect(flat(document.body.textContent ?? "")).toContain(`aren't stored on our servers, ${EXCEPTION}`);
  });
});
