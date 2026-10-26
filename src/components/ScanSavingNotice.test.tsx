// MPC-7470 (D12): the scan-screen and contact-step lines appear only while saving is on.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ScanSavingNotice from "./ScanSavingNotice";

afterEach(() => vi.unstubAllEnvs());

describe("ScanSavingNotice", () => {
  it("shows nothing while saving is off", () => {
    const { container } = render(<><ScanSavingNotice variant="scan" /><ScanSavingNotice variant="contact" /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it("scan screen: says the result stays in the browser and is saved only on request, with the email", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    render(<ScanSavingNotice variant="scan" />);
    expect(screen.getByTestId("scan-saving-notice").textContent).toBe(
      "Your scan result stays in your browser. We save it only if you ask for your report, and only with your email.",
    );
  });

  it("contact step: consistent with the tick box (saved only with the box and an email)", () => {
    vi.stubEnv("VITE_SAVE_WEB_SCANS", "true");
    render(<ScanSavingNotice variant="contact" />);
    expect(screen.getByTestId("contact-saving-notice").textContent).toBe(
      "We save your scan result only if you tick the box above and send your email. Without your email, nothing from your scan is saved.",
    );
  });
});
