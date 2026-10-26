import { describe, expect, it } from "vitest";
import { ARRIVAL, CHANNELS, OBSERVATION_STATES, TELEGRAM_HEXAGONS, TELEGRAM_HEXAGON_COUNT, channelOfHexagon, getChannelHexagon } from "../../shared/hexagon-registry/channels.js";
import { HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";

describe("channel hexagon registry", () => {
  it("defines 30 Telegram hexagons (A 9, B 18, C 2, D 1) with unique tg.* ids and the TG code, outside the 54 web hexagons", () => {
    expect(TELEGRAM_HEXAGON_COUNT).toBe(30);
    expect(new Set(TELEGRAM_HEXAGONS.map((h) => h.id)).size).toBe(30);
    expect(TELEGRAM_HEXAGONS.every((h) => h.id.startsWith("tg.") && h.channel === "TG" && h.label && h.source)).toBe(true);
    const count = (a: string) => TELEGRAM_HEXAGONS.filter((h) => h.arrival === a).length;
    expect([count("A"), count("B"), count("C"), count("D")]).toEqual([9, 18, 2, 1]);
    expect(HEXAGON_COUNT).toBe(54); // the web scan registry is untouched
  });
  it("arrival colours are distinct, never green or red (those mean clear / needs fixing on the tiles), and never colour alone", () => {
    const cols = Object.values(ARRIVAL).map((a) => a.colour);
    expect(new Set(cols).size).toBe(4);
    for (const a of Object.values(ARRIVAL)) {
      expect(a.colour).toMatch(/^#[0-9a-f]{6}$/);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.colour.slice(i, i + 2), 16));
      expect(b).toBeGreaterThan(g); // blue family: blue channel dominates
      expect(b).toBeGreaterThan(r);
      expect(a.label && a.ring && a.id).toBeTruthy();
    }
    expect(new Set(Object.values(ARRIVAL).map((a) => a.ring)).size).toBe(4);
  });
  it("traces an id back to its tool, and never calls a missing field 'hidden'", () => {
    expect(channelOfHexagon("tg.username")).toBe("TG");
    expect(channelOfHexagon("wa.photo")).toBe("WA");
    expect(channelOfHexagon("browser")).toBeNull();
    expect(CHANNELS.telegram.code).toBe("TG");
    expect(getChannelHexagon("tg.bio")?.arrival).toBe("B");
    expect(OBSERVATION_STATES).not.toContain("hidden");
    expect(OBSERVATION_STATES).not.toContain("private");
  });
  it("every disabled hexagon says why", () => {
    for (const h of TELEGRAM_HEXAGONS.filter((x) => !x.enabled)) expect(h.disabledReason).toBeTruthy();
  });
});
