import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeepDive from "./DeepDive";

vi.mock("@/lib/hexagonInteractionApi", () => ({
  fetchDeepDiveScan: vi.fn(),
  fetchFinalScore: vi.fn().mockResolvedValue(null),
  finalizeDeepDive: vi.fn(),
  sendHexagonInteraction: vi.fn().mockResolvedValue(true),
}));
import { fetchDeepDiveScan } from "@/lib/hexagonInteractionApi";

const hex = { id: "hex_contact_profile_pic", pillar: "contact", label: "Profile photo", status: "guess", data: "Has a photo", source: "rapidapi_whatsapp_profile", confidence_score: 0.6, remediation: null, exposure: true };
const open = (q: string) => render(<MemoryRouter initialEntries={[`/scan/deep-dive${q}`]}><DeepDive /></MemoryRouter>);

describe("DeepDive page", () => {
  beforeEach(() => vi.mocked(fetchDeepDiveScan).mockReset());
  afterEach(() => vi.clearAllMocks());

  it("shows the findings from the scan in the link", async () => {
    vi.mocked(fetchDeepDiveScan).mockResolvedValue({ hexagons: [hex as never], finalized: false });
    open("?scan=11111111-1111-4111-8111-111111111111");
    expect(await screen.findByText("Profile photo")).toBeTruthy();
    expect(fetchDeepDiveScan).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("says the link may have expired when the scan cannot be loaded", async () => {
    vi.mocked(fetchDeepDiveScan).mockResolvedValue(null);
    open("?scan=nope");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/expired/));
  });
});
