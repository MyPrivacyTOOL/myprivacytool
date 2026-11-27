// @vitest-environment node
// MPC-11541: /footprint/ shows every registry data point with a Live / In build / Planned badge and no headline total. The page is hand-written static HTML, so this test
// keeps it in step with the site's status marker (FeatureStatus, MPC-9836) and the generated dataset.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import FeatureStatus from "@/components/FeatureStatus";
import { TILE_LABEL, tileState } from "../../shared/hexagon-registry/tileState.js";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";
import { HEXAGONS } from "../../shared/hexagon-registry/registry.js";

const page = readFileSync("public/footprint/index.html", "utf8");
const dataset = JSON.parse(readFileSync("public/footprint/hexagons-366.json", "utf8")) as { id: string; tile: string; slug: string }[];

describe("/footprint/ status badges", () => {
  it("uses the same words as the site status marker", () => {
    for (const s of ["in_build", "planned"] as const) {
      expect(renderToStaticMarkup(createElement(FeatureStatus, { feature: "F9", state: s }))).toContain(`>${TILE_LABEL[s]}<`);
    }
    expect(TILE_LABEL.live).toBe("Live");
    expect(page).toContain("const TL={live:'Live',in_build:'In build',planned:'Planned'}");
  });

  it("the dataset has every catalogue item once, each with a tile state from the one rule", () => {
    expect(dataset.length).toBe(HEXAGON_CATALOGUE.length);
    for (const d of dataset) expect(d.tile).toBe(tileState(HEXAGON_CATALOGUE.find((i) => i.id === d.id)!));
  });

  it("Live is exactly the 54 web scan checks: the page never shows anything else as Live", () => {
    expect(dataset.filter((d) => d.tile === "live").map((d) => d.id).sort()).toEqual(HEXAGONS.map((h) => h.id).sort());
    expect(page).toContain("t==='live'&&!WEB_IDS.has(id)?'planned'"); // a dataset can not make a non-web item Live
  });
});

describe("/footprint/ has no headline total", () => {
  it("page text, title and description carry no 653, 654, 655, 662, 368, 367 or 366", () => {
    const head = page.slice(0, page.indexOf("<style>"));
    const body = page.slice(page.indexOf("<body"), page.indexOf("<script>"));
    for (const part of [head, body]) expect(part).not.toMatch(/\b(653|654|655|662|368|367|366)\b/);
    expect(page).not.toMatch(/\$\{CHANS\.length\} channels found/);
    expect(page).not.toMatch(/N\+' data points'/);
  });
});
