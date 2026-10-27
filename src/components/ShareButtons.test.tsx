import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShareButtons from "./ShareButtons";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackShare: (...a: unknown[]) => track(...a) }));

afterEach(() => {
  track.mockClear();
  vi.unstubAllGlobals();
});

describe("ShareButtons", () => {
  it("renders safe external links and tracks clicks", () => {
    render(<ShareButtons where="thank_you" />);
    const wa = screen.getByRole("link", { name: "WhatsApp" });
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(wa);
    expect(track).toHaveBeenCalledWith("whatsapp", "thank_you");
  });

  it("copies a tagged link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ShareButtons where="scan_page" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Link copied");
    expect(writeText.mock.calls[0][0]).toContain("utm_medium=copy");
  });

  it("offers the native share sheet only when the browser has one", () => {
    const { unmount } = render(<ShareButtons where="scan_page" />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    unmount();
    vi.stubGlobal("navigator", { share: vi.fn().mockResolvedValue(undefined) });
    render(<ShareButtons where="scan_page" />);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});
