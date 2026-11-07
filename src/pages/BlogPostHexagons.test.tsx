import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BlogPost from "./BlogPost";
import { HEXAGONS, HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";

// MPC-9832: the "How Exposed Are You" category lists must be the registry's 54, not a hand-written 46.
describe("blog: how-exposed-are-you lists the registry's hexagons", () => {
  it("shows every registry hexagon once, grouped by registry group, with the one count sentence", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/blog/how-exposed-are-you"]}>
        <Routes><Route path="/blog/:slug" element={<BlogPost />} /></Routes>
      </MemoryRouter>,
    );
    const items = [...container.querySelectorAll("article li, .article li")].map((li) => li.textContent);
    const labels = HEXAGONS.map((h) => h.label);
    expect(HEXAGON_COUNT).toBe(54);
    labels.forEach((l) => expect(items.filter((t) => t === l).length).toBeGreaterThanOrEqual(1));
    const text = container.textContent ?? "";
    expect(text).toContain("54 run in the scan, 368 in the catalogue");
    expect(text).not.toMatch(/\b46\b/);
    const headingCounts = [...container.querySelectorAll("h3")].map((h) => /\((\d+)\)$/.exec(h.textContent ?? "")?.[1]).filter(Boolean).map(Number);
    expect(headingCounts.reduce((a, b) => a + b, 0)).toBe(54);
  });
});

import ScoreMethod from "./ScoreMethod";
import { countSentence } from "@/lib/scanCopy";

describe("one count sentence (MPC-9832)", () => {
  it("is exactly '54 run in the scan, 368 in the catalogue' and appears on the score page", () => {
    expect(countSentence()).toBe("54 run in the scan, 368 in the catalogue");
    const { container } = render(<MemoryRouter><ScoreMethod /></MemoryRouter>);
    expect(container.textContent).toContain("54 run in the scan, 368 in the catalogue");
    expect(container.textContent).not.toMatch(/\b46\b/);
  });
});
