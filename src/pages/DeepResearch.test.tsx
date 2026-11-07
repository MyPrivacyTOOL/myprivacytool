import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeepResearch from "./DeepResearch";
import { DEEP_HEXAGONS } from "@/config/deepResearch";

vi.mock("@/lib/pwnedPassword", () => ({
  checkPassword: vi.fn().mockResolvedValue({ status: "found", count: 42 }),
}));

const open = () =>
  render(
    <MemoryRouter>
      <DeepResearch />
    </MemoryRouter>,
  );

describe("DeepResearch page", () => {
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

  it("runs the free password check and shows the result", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Password to check"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Check password" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/appears in known breaches \(42 times\)/));
  });
});
