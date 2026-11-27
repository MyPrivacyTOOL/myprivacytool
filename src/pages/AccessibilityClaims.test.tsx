// MPC-9805 (EXT-18, Q14 decision 2026-11-18): /accessibility must not claim "full keyboard access" or "tested with NVDA, JAWS, VoiceOver, TalkBack"
// until those tests have run and are recorded. The display-preferences hexagon must not say it "can hint at a disability".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderPage } from "@/test/render";
import Accessibility from "./Accessibility";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("/accessibility claims", () => {
  it("does not claim full keyboard access or that it was tested with named screen readers; says what is not yet done", () => {
    renderPage(<Accessibility />);
    const text = flat(document.body.textContent);
    expect(text).not.toMatch(/Full Keyboard Access/i);
    expect(text).not.toMatch(/is tested with and supports/i);
    expect(text).toContain("We have not yet completed and recorded a keyboard-only test of every page");
    expect(text).toContain("We have not yet completed and recorded tests with each of them");
    expect(text).toContain("treat this list as our target, not as a result");
    // the named tools may still be listed, as targets
    for (const t of ["NVDA", "JAWS", "VoiceOver", "TalkBack"]) expect(text).toContain(t);
  });
});

describe("display-preferences hexagon wording (ACCESS-001)", () => {
  const h = HEXAGON_CATALOGUE.find((x: { id: string }) => x.id === "web.display_prefs") as { reveals: string };
  it("the catalogue and its sources no longer say it can hint at a disability", () => {
    expect(h.reveals).not.toMatch(/hint at a disability/i);
    expect(h.reveals).toMatch(/accessibility settings, so treat them as sensitive/);
    for (const f of ["shared/hexagon-registry/hexagons-366.json", "public/footprint/hexagons-662.json"]) expect(readFileSync(f, "utf8")).not.toMatch(/hint at a disability/i);
  });
});

// MPC-9805 (TECH-009): the Extensions result says what is measured: a decoy-element guess and the browser's plug-in list, not a list of extensions.
describe("Extensions hexagon wording", () => {
  const src = readFileSync("src/lib/deviceDetection.ts", "utf8");
  it("the live value and risk text no longer claim extensions are detected", () => {
    expect(src).not.toContain("Ad Blocker: Yes");
    expect(src).not.toMatch(/\$\{pluginsResult\.pluginCount\} detected/);
    expect(src).toContain("Ad blocker likely");
    expect(src).toContain("browser plug-in");
    expect(src).toContain("neither can we");
    expect(src).not.toMatch(/Browser extensions and plugins add to your unique fingerprint/);
  });
  it("the registry entry matches the live wording", () => {
    const reg = readFileSync("shared/hexagon-registry/registry.js", "utf8");
    expect(reg).toContain('"example_value": "Ad blocker likely"');
    expect(reg).not.toContain("Browser extensions and plugins add to your unique fingerprint");
  });
});

// MPC-9805: reduced motion also stops the hero hands and the ping dots (measured live: four infinite animations were still running).
describe("reduced motion CSS", () => {
  const css = readFileSync("src/index.css", "utf8");
  it("stops the hands and the ping dots under prefers-reduced-motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const c of [".animate-hand-push-left", ".animate-hand-push-center", ".animate-hand-push-right", ".animate-ping"]) expect(block).toContain(c);
    expect(block).toMatch(/\.animate-ping \{ animation: none !important/);
  });
});
