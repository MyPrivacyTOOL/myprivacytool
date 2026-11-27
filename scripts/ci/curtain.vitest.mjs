// The reusable brand curtain (public/curtain/): one pure drawing function shared by the website, the
// <mpt-curtain> element and the video/GIF renderer. These tests pin the brand rules from
// assets/alice/spec/animation-production.md 4a (same folds and speed every time, 0.5-1.5 s, white and black
// only) and the element's accessibility behaviour.
import { describe, expect, it, vi, afterEach } from "vitest";
import { curtainSvg, geometry, ease, BRAND } from "../../public/curtain/curtain-core.js";
import { frameTimes } from "../../tools/curtain/render.mjs";
import { pleatFrame, stripRightEdge, easeInOut, PLEAT } from "../../public/curtain/curtain-pleat.js";

describe("curtain core (pure drawing)", () => {
  it("is deterministic: the same progress always draws the same curtain", () => {
    expect(curtainSvg(0.4)).toBe(curtainSvg(0.4));
    expect(curtainSvg(0.4)).not.toBe(curtainSvg(0.41));
    expect(curtainSvg(0.4, { seed: 8 })).not.toBe(curtainSvg(0.4));
  });
  it("starts closed (panels meet in the middle) and ends gathered at the sides", () => {
    expect(geometry(0, { width: 1000 }).panelW).toBeCloseTo(500, 9);
    expect(geometry(1, { width: 1000 }).panelW).toBeCloseTo((1000 * BRAND.gatherPct) / 100, 9);
    expect(geometry(1, { width: 1000 }).openFraction).toBeGreaterThan(0.85);
  });
  it("only ever opens: the panels never move back toward the middle", () => {
    let prev = Infinity;
    for (let i = 0; i <= 200; i++) {
      const w = geometry(i / 200, { width: 1000 }).panelW;
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
  });
  it("eases: slow start, soft landing, clamped outside 0..1", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 9);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });
  it("draws clean SVG in brand colours only (black ink, white paper) at any size", () => {
    for (const [w, h] of [[390, 300], [1000, 600], [1920, 1080], [1080, 1920]]) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const s = curtainSvg(t, { width: w, height: h });
        expect(s).not.toMatch(/NaN|undefined|Infinity/);
        expect(s.startsWith("<svg xmlns=")).toBe(true);
        const colours = [...new Set((s.match(/#[0-9a-fA-F]{6}/g) || []).map((c) => c.toLowerCase()))];
        expect(colours.every((c) => c === "#000000" || c === "#ffffff")).toBe(true);
      }
    }
  });
  it("brand duration stays inside the spec range of 0.5 to 1.5 seconds", () => {
    expect(BRAND.durationMs).toBeGreaterThanOrEqual(500);
    expect(BRAND.durationMs).toBeLessThanOrEqual(1500);
  });
});

describe("render timeline (video / GIF export)", () => {
  it("holds closed, opens in the brand time, then holds open, ending exactly open", () => {
    const ts = frameTimes({ fps: 30, ms: 1200, holdStart: 400, holdEnd: 600 });
    expect(ts.length).toBe(12 + 37 + 18);
    expect(ts[0]).toBe(0);
    expect(ts[11]).toBe(0);
    expect(ts[ts.length - 1]).toBe(1);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
  });
});

describe("<mpt-curtain> element", () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

  async function make(attrs = "") {
    await import("../../public/curtain/curtain-element.js");
    document.body.innerHTML = `<mpt-curtain trigger="manual" ${attrs}><p id="behind">Revealed content</p></mpt-curtain>`;
    return document.querySelector("mpt-curtain");
  }

  it("is registered, keeps the revealed content in the page, and marks the curtain decorative", async () => {
    const el = await make();
    expect(customElements.get("mpt-curtain")).toBeTruthy();
    expect(el.querySelector("#behind").textContent).toBe("Revealed content");
    expect(el.shadowRoot.querySelector(".veil").getAttribute("aria-hidden")).toBe("true");
  });
  it("draws the closed curtain, and scrubbing progress redraws it", async () => {
    const el = await make();
    const closed = el.shadowRoot.querySelector(".veil").innerHTML;
    expect(closed).toContain("<svg");
    el.progress = 0.5;
    expect(el.shadowRoot.querySelector(".veil").innerHTML).not.toBe(closed);
    expect(el.hasAttribute("data-open")).toBe(false);
  });
  it("fires curtain-open once fully open, and reset() closes it again", async () => {
    const el = await make();
    const seen = vi.fn();
    el.addEventListener("curtain-open", seen);
    el.progress = 1;
    el.progress = 1;
    expect(seen).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute("data-open")).toBe(true);
    el.reset();
    expect(el.hasAttribute("data-open")).toBe(false);
    expect(el.progress).toBe(0);
  });
  it("opens at once, with no animation, for visitors who prefer reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const el = await make();
    await el.play();
    expect(el.progress).toBe(1);
    expect(el.hasAttribute("data-open")).toBe(true);
  });
});

describe("pleated pull-back (picture drawn back like a curtain)", () => {
  const o = { n: 14, width: 1400, side: "right" };
  it("starts as the flat picture: strips side by side, no fold, no shading", () => {
    const f = pleatFrame(0, o);
    f.strips.forEach((s, i) => {
      expect(s.x).toBeCloseTo(i * 100, 9);
      expect(s.z).toBeCloseTo(0, 9);
      expect(s.deg).toBeCloseTo(0, 9);
      expect(s.dark).toBeCloseTo(0, 9);
    });
    expect(f.bundleWidth).toBeCloseTo(1400, 9);
  });
  it("ends gathered into a bundle of the brand percentage at the chosen side", () => {
    const f = pleatFrame(1, o);
    expect(f.bundleWidth).toBeCloseTo((1400 * PLEAT.gatherPct) / 100, 6);
    expect(f.strips[0].x + f.bundleWidth).toBeCloseTo(1400, 6);
    const left = pleatFrame(1, { ...o, side: "left" });
    expect(left.strips[0].x).toBeCloseTo(0, 9);
    expect(left.bundleWidth).toBeCloseTo((1400 * PLEAT.gatherPct) / 100, 6);
  });
  it("is one continuous cloth: every strip's right edge meets the next strip's left edge in 3D, at every moment", () => {
    for (const side of ["right", "left"]) {
      for (let k = 0; k <= 40; k++) {
        const f = pleatFrame(k / 40, { ...o, side });
        for (let i = 0; i < o.n - 1; i++) {
          const r = stripRightEdge(f, i), l = f.strips[i + 1];
          expect(Math.hypot(r.x - l.x, r.z - l.z)).toBeLessThan(1e-6);
        }
      }
    }
  });
  it("only gathers: the bundle never widens while the cloth is drawn back", () => {
    let prev = Infinity;
    for (let k = 0; k <= 100; k++) {
      const w = pleatFrame(k / 100, o).bundleWidth;
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
  });
});
