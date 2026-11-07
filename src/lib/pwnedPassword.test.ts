import { describe, expect, it, vi } from "vitest";
import { checkPassword, countFromRange, sha1Hex } from "./pwnedPassword";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PW_PREFIX = "5BAA6";
const PW_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
const rangeBody = (rows: string[]) => rows.join("\r\n");
const okFetch = (body: string, status = 200) =>
  vi.fn().mockResolvedValue(new Response(body, { status })) as unknown as typeof fetch;

describe("pwnedPassword", () => {
  it("hashes with SHA-1, uppercase hex", async () => {
    expect(await sha1Hex("password")).toBe(PW_PREFIX + PW_SUFFIX);
  });

  it("parses the count for a suffix and ignores padding rows", () => {
    const body = rangeBody([`${PW_SUFFIX}:9545824`, "00000000000000000000000000000000000:0"]);
    expect(countFromRange(body, PW_SUFFIX)).toBe(9545824);
    expect(countFromRange(body, "ABCDEF0000000000000000000000000000A")).toBe(0);
  });

  it("sends only the 5-character prefix, never the password or full hash", async () => {
    const f = okFetch(rangeBody([`${PW_SUFFIX}:12`]));
    const r = await checkPassword("password", f);
    expect(r).toEqual({ status: "found", count: 12 });
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PW_PREFIX}`);
    expect(String(url)).not.toContain(PW_SUFFIX);

    // A distinctive password must not appear in the request at all, in either its plain or hashed form.
    const g = okFetch(rangeBody(["0018A45C4D1DEF81644B54AB7F969B88D65:3"]));
    await checkPassword("zq-unique-secret-91", g);
    const [url2] = (g as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url2)).not.toContain("zq-unique-secret-91");
    expect(String(url2).split("/range/")[1]).toHaveLength(5);
  });

  it("returns not_found when the suffix is absent", async () => {
    const f = okFetch(rangeBody(["0018A45C4D1DEF81644B54AB7F969B88D65:3"]));
    expect(await checkPassword("password", f)).toEqual({ status: "not_found" });
  });

  it("is not_checked, never safe, on empty input, network failure, bad status or junk body", async () => {
    expect(await checkPassword("", okFetch(""))).toEqual({ status: "not_checked", reason: "empty" });
    const boom = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await checkPassword("x", boom)).toEqual({ status: "not_checked", reason: "network" });
    expect(await checkPassword("x", okFetch("", 429))).toEqual({ status: "not_checked", reason: "network" });
    expect(await checkPassword("x", okFetch("<html>nope</html>"))).toEqual({
      status: "not_checked",
      reason: "bad_response",
    });
  });
});
