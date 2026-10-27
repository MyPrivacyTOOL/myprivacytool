import { describe, expect, it } from "vitest";
import { suggestEmail } from "./emailTypo";

describe("suggestEmail (MPC-8453)", () => {
  it("fixes the common slips and keeps the part before the @ exactly as typed", () => {
    expect(suggestEmail("Jane.Smith+tag@gmial.com")).toBe("Jane.Smith+tag@gmail.com");
    expect(suggestEmail("  a@hotmail.con ")).toBe("a@hotmail.com");
    expect(suggestEmail("a@YAHOOO.COM")).toBe("a@yahoo.com");
    expect(suggestEmail("a@outlok.com")).toBe("a@outlook.com");
    expect(suggestEmail("a@gmail.co")).toBe("a@gmail.com");
  });
  it("says nothing for correct, unknown or malformed addresses", () => {
    for (const ok of ["a@gmail.com", "a@my-own-company.io", "a@gmail.com.au", "a@", "@gmail.con", "plain", ""]) expect(suggestEmail(ok)).toBeNull();
  });
});
