import { describe, expect, it } from "vitest";
import { friendlySubmitError, suggestEmail, validateEmail } from "./formFeedback";

describe("validateEmail", () => {
  it("accepts normal addresses and trims whitespace", () => {
    expect(validateEmail("  me@example.com ")).toBeNull();
    expect(validateEmail("first.last+tag@sub.example.co.uk")).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(validateEmail("")).toMatch(/enter your email/i);
    expect(validateEmail("me@example")).toMatch(/doesn't look like/i);
    expect(validateEmail("me example.com")).toMatch(/doesn't look like/i);
  });
});

describe("suggestEmail", () => {
  it("fixes common domain typos only", () => {
    expect(suggestEmail("sam@gmial.com")).toBe("sam@gmail.com");
    expect(suggestEmail("sam@GMAIL.CON")).toBe("sam@gmail.com");
    expect(suggestEmail("sam@gmail.com")).toBeNull();
    expect(suggestEmail("sam")).toBeNull();
  });
});

describe("friendlySubmitError", () => {
  it("translates network failures and 5xx", () => {
    expect(friendlySubmitError(new TypeError("Failed to fetch"))).toMatch(/couldn't reach/i);
    expect(friendlySubmitError(new Error("HubSpot error 503"))).toMatch(/our side/i);
  });
  it("passes through HubSpot's own message otherwise", () => {
    expect(friendlySubmitError(new Error("Form not found"))).toBe("Form not found");
    expect(friendlySubmitError("x")).toBe("Something went wrong. Please try again.");
  });
});
