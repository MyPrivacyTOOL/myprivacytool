// MPC-7471-F4: the public explanation page reads its weights and bands from the same constants the score uses.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ScoreMethod from "./ScoreMethod";
import { CATEGORY_WEIGHTS, BANDS, SCORE_VERSION, WEIGHT_TOTAL } from "../../shared/hexagon-registry/score.js";

const renderPage = () => render(<MemoryRouter><ScoreMethod /></MemoryRouter>);

describe("How we calculate your score", () => {
  it("states what the number means and what it does not mean", () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "How we calculate your score" })).toBeInTheDocument();
    const text = container.textContent ?? "";
    expect(text).toContain("how much your browser revealed to us");
    expect(text).toContain("not a chance that something bad will happen");
  });

  it("shows every band and every weight from the shared constants, and the weights add up to 100%", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";
    for (const b of BANDS) expect(text).toContain(`${b.from} to ${b.to}`);
    for (const w of Object.values(CATEGORY_WEIGHTS)) expect(text).toContain(`${w}%`);
    expect(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(WEIGHT_TOTAL);
    expect(screen.getAllByText(SCORE_VERSION).length).toBeGreaterThan(0);
  });

  it("explains coverage, provisional scores and version comparison limits", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Coverage" })).toBeInTheDocument();
    expect(screen.getByText(/provisional/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be compared/)).toBeInTheDocument();
    expect(screen.getByText(/Not checked/)).toBeInTheDocument();
  });
});
