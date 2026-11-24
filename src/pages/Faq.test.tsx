// CK-7721 part B: the FAQ carries the saved-scan exception (Privacy Policy 2.4 and 6) and four factual items.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Faq from "./Faq";
import ThankYou from "./ThankYou";
import { STORAGE_NOTE } from "@/data/trustCopy";
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
    expect(text).toContain("read aloud by your own device's voice, and nothing you do with her voice is sent to us.");
    expect(text).toContain("There is no live chat with her on the site today.");
    expect(text).toContain("kept for 12 months".replace("kept", "we keep it"));
    expect(text).toContain("write to privacy@myprivacytool.io");
    expect(text).not.toMatch(/open[- ]source/i);
  });
});

describe("Thank-you page trust line", () => {
  // MPC-11242: the line is the shared home-page sentence (src/data/trustCopy.ts); it still carries the save exception.
  it("carries the save exception", () => {
    render(
      <MemoryRouter initialEntries={["/thank-you?source=contact"]}>
        <ThankYou />
      </MemoryRouter>,
    );
    expect(flat(document.body.textContent ?? "")).toContain(STORAGE_NOTE);
    expect(STORAGE_NOTE).toContain("We save a scan only if you tick");
    expect(STORAGE_NOTE).toContain("we then keep it for 12 months");
  });
});

// CK-9848: the FAQ states the retention of the scan delivery record.
describe("FAQ: report delivery record retention (CK-9848)", () => {
  it("states 7 days after delivery unless you keep your scan (MPC-9894)", () => {
    renderPage(<Faq />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("The delivery record for a scan is kept 7 days after your report is delivered, then deleted, unless you keep your scan.");
  });
});
