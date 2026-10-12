// MPC-7649: monitoring dashboard preview.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import { parseMonitoringEnabled } from "@/config/monitoring";
import Monitoring from "./Monitoring";

describe("monitoring switch", () => {
  it("is off unless explicitly turned on", () => {
    expect(parseMonitoringEnabled(undefined)).toBe(false);
    expect(parseMonitoringEnabled("false")).toBe(false);
    expect(parseMonitoringEnabled("True")).toBe(true);
  });
});

describe("Monitoring page (vitest runs in dev, so the preview shows)", () => {
  it("shows the sample banner, the checks and the exposures", () => {
    renderPage(<Monitoring />);
    expect(screen.getByText(/Preview with sample data/)).toBeTruthy();
    expect(screen.getByText("Daily breach check")).toBeTruthy();
    expect(screen.getByText("ExampleShop (2026)")).toBeTruthy();
  });

  it("marking an exposure not mine moves the false-positive rate", () => {
    renderPage(<Monitoring />);
    expect(screen.getByText("0%")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Not mine" })[0]);
    expect(screen.getByText("33.33%")).toBeTruthy();
  });
});
