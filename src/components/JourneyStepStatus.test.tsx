import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

describe("Journey step badges (MPC-9832)", () => {
  it("every one of the 8 steps renders the state set in JOURNEY_STEPS", async () => {
    vi.resetModules();
    vi.doMock("@/config/featureStatus", () => ({
      FEATURE_STATUS: {},
      JOURNEY_STEPS: { 1: "live", 2: "in_build", 3: "planned", 4: "planned", 5: "live", 6: "in_build", 7: "planned", 8: "planned" },
    }));
    const { default: JourneyGuide } = await import("./JourneyGuide");
    const { container } = render(<MemoryRouter><JourneyGuide /></MemoryRouter>);
    const expected = { 1: "live", 2: "in_build", 3: "planned", 4: "planned", 5: "live", 6: "in_build", 7: "planned", 8: "planned" } as const;
    for (const [step, state] of Object.entries(expected)) {
      // one badge in the step list, plus one in the detail panel for the selected step (step 1)
      const badges = container.querySelectorAll(`[data-journey-step="${step}"]`);
      expect(badges.length).toBeGreaterThan(0);
      badges.forEach((b) => expect(b.getAttribute("data-journey-state")).toBe(state));
    }
    expect(screen.getAllByText("Live").length).toBeGreaterThanOrEqual(2);
    vi.doUnmock("@/config/featureStatus");
  });

  it("config covers steps 1-8 with valid states, and only step 1 is live today", async () => {
    vi.resetModules();
    const { JOURNEY_STEPS } = await import("@/config/featureStatus");
    expect(Object.keys(JOURNEY_STEPS)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    Object.values(JOURNEY_STEPS).forEach((s) => expect(["live", "in_build", "planned"]).toContain(s));
    expect(Object.values(JOURNEY_STEPS).filter((s) => s === "live")).toHaveLength(1);
  });
});
