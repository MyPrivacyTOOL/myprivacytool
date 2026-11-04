import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAssignment, pickVariant, type Experiment } from "./abTest";

const exp = (over: Partial<Experiment> = {}): Experiment => ({
  id: "t",
  description: "test",
  enabled: true,
  variants: [
    { id: "control", weight: 50 },
    { id: "b", weight: 50 },
  ],
  ...over,
});

describe("pickVariant", () => {
  const v = [
    { id: "a", weight: 70 },
    { id: "b", weight: 30 },
  ];
  it("respects weights at the boundaries", () => {
    expect(pickVariant(v, 0)).toBe("a");
    expect(pickVariant(v, 0.699)).toBe("a");
    expect(pickVariant(v, 0.7)).toBe("b");
    expect(pickVariant(v, 0.999)).toBe("b");
  });
  it("falls back to control when all weights are zero", () => {
    expect(pickVariant([{ id: "a", weight: 0 }, { id: "b", weight: 0 }], 0.9)).toBe("a");
  });
});

describe("getAssignment", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("serves control and stores nothing while the experiment is off", () => {
    const a = getAssignment(exp({ enabled: false }), "");
    expect(a).toMatchObject({ variantId: "control", active: false, forced: false });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("buckets once and keeps the variant for the session", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((buf: Uint32Array) => {
      buf[0] = 0xffffffff; // rand ~ 1 -> last variant
      return buf;
    }) as typeof crypto.getRandomValues);
    const first = getAssignment(exp(), "");
    expect(first).toMatchObject({ variantId: "b", active: true });
    vi.restoreAllMocks();
    expect(getAssignment(exp(), "").variantId).toBe("b");
  });

  it("lets ?ab_<id>=<variant> force a variant without storing it", () => {
    const a = getAssignment(exp({ enabled: false }), "?ab_t=b");
    expect(a).toMatchObject({ variantId: "b", forced: true, active: false });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("ignores unknown forced variants and corrupt stored values", () => {
    window.sessionStorage.setItem("mpt_ab_t", "nope");
    const a = getAssignment(exp(), "?ab_t=zzz");
    expect(["control", "b"]).toContain(a.variantId);
    expect(a.forced).toBe(false);
  });

  it("still works when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(["control", "b"]).toContain(getAssignment(exp(), "").variantId);
  });
});
