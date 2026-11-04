import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeepDive from "./DeepDive";

vi.mock("@/lib/hexagonInteractionApi", () => ({
  fetchDeepDiveScan: vi.fn(),
  fetchFinalScore: vi.fn().mockResolvedValue(null),
  finalizeDeepDive: vi.fn(),
  sendHexagonInteraction: vi.fn().mockResolvedValue(true),
  isDeepDiveApiConfigured: vi.fn().mockReturnValue(true),
}));
import { fetchDeepDiveScan, isDeepDiveApiConfigured } from "@/lib/hexagonInteractionApi";

const hex = { id: "hex_contact_profile_pic", pillar: "contact", label: "Profile photo", status: "guess", data: "Has a photo", source: "rapidapi_whatsapp_profile", confidence_score: 0.6, remediation: null, exposure: true };
const open = (q: string) => render(<MemoryRouter initialEntries={[`/scan/deep-dive${q}`]}><DeepDive /></MemoryRouter>);

describe("DeepDive page", () => {
  beforeEach(() => { vi.mocked(fetchDeepDiveScan).mockReset(); vi.mocked(isDeepDiveApiConfigured).mockReturnValue(true); });
  afterEach(() => vi.clearAllMocks());

  it("shows the findings from the scan in the link", async () => {
    vi.mocked(fetchDeepDiveScan).mockResolvedValue({ hexagons: [hex as never], finalized: false });
    open("?scan=11111111-1111-4111-8111-111111111111");
    expect(await screen.findByText("Profile photo")).toBeTruthy();
    expect(fetchDeepDiveScan).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("shows the heading and intro only when there is something to confirm", async () => {
    vi.mocked(fetchDeepDiveScan).mockResolvedValue({ hexagons: [hex as never], finalized: false });
    open("?scan=11111111-1111-4111-8111-111111111111");
    expect(await screen.findByText("Profile photo")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Is this you?" })).toBeTruthy();
  });

  it("no scan in the link: says the page needs the WhatsApp link, without the intro, and calls nothing", () => {
    open("");
    expect(screen.getByRole("alert").textContent).toMatch(/needs the link from your WhatsApp message/);
    expect(screen.queryByRole("heading", { name: "Is this you?" })).toBeNull();
    expect(fetchDeepDiveScan).not.toHaveBeenCalled();
  });

  it("expired or unknown scan: says the link may have expired, without the intro", async () => {
    vi.mocked(fetchDeepDiveScan).mockResolvedValue(null);
    open("?scan=nope");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/may have expired/));
    expect(screen.queryByRole("heading", { name: "Is this you?" })).toBeNull();
  });

  it("API address not set: says the page is not available yet, not that the link expired, and calls nothing", () => {
    vi.mocked(isDeepDiveApiConfigured).mockReturnValue(false);
    open("?scan=11111111-1111-4111-8111-111111111111");
    expect(screen.getByRole("alert").textContent).toMatch(/isn't available yet/);
    expect(screen.getByRole("alert").textContent).not.toMatch(/expired/);
    expect(fetchDeepDiveScan).not.toHaveBeenCalled();
  });
});
