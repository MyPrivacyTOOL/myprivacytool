import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeepResearch from "./DeepResearch";
import { DEEP_HEXAGONS } from "@/config/deepResearch";

// The password check itself lives in src/lib/pwnedPassword.ts (MPC-9776) and is tested there. Here only the page wiring is tested.
vi.mock("@/lib/pwnedPassword", () => ({
  checkPwnedPassword: vi.fn().mockResolvedValue({ status: "checked", count: 42 }),
  passwordCheckEnabled: vi.fn(),
}));
import { passwordCheckEnabled } from "@/lib/pwnedPassword";

const open = () =>
  render(
    <MemoryRouter>
      <DeepResearch />
    </MemoryRouter>,
  );

describe("DeepResearch page", () => {
  beforeEach(() => vi.mocked(passwordCheckEnabled).mockReturnValue(false));

  it("lists the five hexagons in the approved order, credential leak first", () => {
    open();
    const ids = DEEP_HEXAGONS.map((h) => h.id);
    expect(ids).toEqual([
      "cred_leak_trace",
      "darkweb_breach_map",
      "osint_social_graph",
      "network_device_fp",
      "crypto_asset_flow",
    ]);
    ids.forEach((id) => expect(screen.getByTestId(`deep-${id}`)).toBeTruthy());
  });

  it("no hexagon is marked built while no provider is connected", () => {
    expect(DEEP_HEXAGONS.every((h) => h.build_state === "planned")).toBe(true);
  });

  it("opens a Coming soon popup for a paid-provider hexagon", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Dark Web Breach Mapping: coming soon/i }));
    expect(screen.getByText("Dark Web Breach Mapping: coming soon")).toBeTruthy();
    expect(screen.getByText(/Needs: Licensed threat-intelligence feed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/Needs: Licensed threat-intelligence feed/)).toBeNull();
  });

  it("says Coming soon, not Free now, for the credential card while the password check flag is off", () => {
    open();
    const card = screen.getByTestId("deep-cred_leak_trace");
    expect(card.textContent).toContain("Coming soon");
    expect(card.textContent).not.toContain("Free now");
    expect(screen.queryByLabelText("Password to check")).toBeNull();
  });

  it("shows the free password check and its result once the flag is on", async () => {
    vi.mocked(passwordCheckEnabled).mockReturnValue(true);
    open();
    expect(screen.getByTestId("deep-cred_leak_trace").textContent).toContain("Free now");
    fireEvent.change(screen.getByLabelText("Password to check"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/appeared 42 times/));
  });
});
