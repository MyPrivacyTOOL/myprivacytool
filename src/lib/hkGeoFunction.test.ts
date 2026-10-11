// @vitest-environment node
import { describe, expect, it } from "vitest";
import { countryFromHeader, onRequestGet } from "../../functions/api/hk-geo";

describe("hk-geo Pages Function", () => {
  it("normalises CF-IPCountry", () => {
    expect(countryFromHeader("hk")).toBe("HK");
    expect(countryFromHeader(" HK ")).toBe("HK");
    expect(countryFromHeader("XX")).toBeNull();
    expect(countryFromHeader("T1")).toBeNull();
    expect(countryFromHeader("")).toBeNull();
    expect(countryFromHeader(null)).toBeNull();
    expect(countryFromHeader("HKG")).toBeNull();
  });

  it("returns only the country, uncached", async () => {
    const res = onRequestGet({ request: new Request("https://x.test/api/hk-geo", { headers: { "CF-IPCountry": "HK" } }) });
    expect(await res.json()).toEqual({ country: "HK" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const none = onRequestGet({ request: new Request("https://x.test/api/hk-geo") });
    expect(await none.json()).toEqual({ country: null });
  });
});
