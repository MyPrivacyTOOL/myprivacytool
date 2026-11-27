import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

describe("FeatureStatus (MPC-9836)", () => {
  it("renders text markers for non-live features and nothing for live", async () => {
    vi.resetModules();
    vi.doMock("@/config/featureStatus", () => ({
      FEATURE_STATUS: { F1: "planned", F8: "in_build", F9: "live" },
    }));
    const { default: FeatureStatus } = await import("./FeatureStatus");
    const { container } = render(
      <p>
        <FeatureStatus feature={"F1" as never} />
        <FeatureStatus feature={"F8" as never} />
        <FeatureStatus feature={"F9" as never} />
      </p>,
    );
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText("In build")).toBeTruthy();
    expect(container.querySelectorAll("[data-feature-status]")).toHaveLength(2);
    vi.doUnmock("@/config/featureStatus");
  });

  it("config lists all 11 feature keys (F1-F10, F7 split)", async () => {
    vi.resetModules();
    const { FEATURE_STATUS } = await import("@/config/featureStatus");
    expect(Object.keys(FEATURE_STATUS).sort()).toEqual(
      ["F1", "F10", "F2", "F3", "F4", "F5", "F6", "F7a", "F7b", "F8", "F9"].sort(),
    );
  });
});
