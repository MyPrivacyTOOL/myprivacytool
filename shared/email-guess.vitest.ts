// @vitest-environment node
// MPC-11111: the magic guess. Only an address the person published in their own bio is a guess; the token hides it and expires.
import { describe, expect, it } from "vitest";
import { addressesIn, emailGuessOn, guessFromProfile, MAX_TOKEN_CHARS, MIN_CONFIDENCE, openGuess, sealGuess, validEmail } from "./email-guess.ts";

const KEY = "unit-test-key-0123456789abcdef";   // not a real secret
const NOW = Date.UTC(2026, 10, 24, 6, 0, 0);
const guess = { email: "jane.doe@example.org", confidence: 0.9, basis: "bio_email" as const };

describe("finding a published address", () => {
  it("one address in the bio is a guess at 90 percent, lower-cased", () => {
    const g = guessFromProfile({ bio: "Designer in Leeds. Mail me: Jane.Doe@Example.ORG, I reply fast." });
    expect(g).toEqual({ email: "jane.doe@example.org", confidence: 0.9, basis: "bio_email" });
    expect(g!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });
  it("the same address written twice is still one address", () => {
    expect(guessFromProfile({ bio: "jane@example.org | JANE@example.org" })?.email).toBe("jane@example.org");
  });
  it("trailing punctuation and surrounding text do not become part of the address", () => {
    expect(guessFromProfile({ bio: "contact: (jane@example.org)." })?.email).toBe("jane@example.org");
    expect(guessFromProfile({ bio: "jane@example.org." })?.email).toBe("jane@example.org");
  });
  it("two different addresses is ambiguous: no guess", () => {
    expect(guessFromProfile({ bio: "work jane@example.org home jane@example.net" })).toBeNull();
  });
  it("no address, a handle, a bare domain or an empty bio: no guess", () => {
    expect(guessFromProfile({ bio: "Follow @jane on example.org" })).toBeNull();
    expect(guessFromProfile({ bio: "jane at example dot org" })).toBeNull();   // obfuscated forms are not read
    expect(guessFromProfile({ bio: "" })).toBeNull();
    expect(guessFromProfile({})).toBeNull();
    expect(guessFromProfile(null)).toBeNull();
    expect(guessFromProfile({ bio: 42 as unknown as string })).toBeNull();
  });
  it("nothing is ever derived from a name or a handle", () => {
    expect(guessFromProfile({ bio: "Jane Doe, @janedoe, Leeds" })).toBeNull();
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["a@b", "a..b@example.org", ".a@example.org", "a.@example.org", "a@-example.org", "a@example-.org", "a@example.c", "@example.org", "a@@example.org", "a b@example.org"]) {
      expect(validEmail(bad), bad).toBe(false);
    }
    expect(validEmail("a@example.org")).toBe(true);
    expect(validEmail(`${"a".repeat(65)}@example.org`)).toBe(false);
    expect(addressesIn(`x${"a".repeat(80)}@example.org`)).toEqual([]);   // a 65+ character local part is cut by the finder and fails the length rule
  });
  it("never cuts an address out of the middle of something longer", () => {
    expect(guessFromProfile({ bio: `${"a".repeat(70)}@example.org` })).toBeNull();            // 70-character local part: not 'the last 64 of it'
    expect(guessFromProfile({ bio: "jane@example.organization123" })).toBeNull();            // TLD followed by digits: not 'jane@example.organization'
    expect(guessFromProfile({ bio: "jane@example.org_" })?.email).toBe("jane@example.org");  // an underscore after the TLD ends it
    expect(guessFromProfile({ bio: "mail jane@example.co.uk now" })?.email).toBe("jane@example.co.uk");
  });
  it("reads at most the first 2000 characters", () => {
    expect(guessFromProfile({ bio: `${" ".repeat(2100)}jane@example.org` })).toBeNull();
  });
});

describe("the token", () => {
  it("round-trips and carries the channel and confidence", async () => {
    const token = await sealGuess(KEY, guess, "x", { now: NOW });
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await openGuess(KEY, token, NOW + 1000)).toEqual({ email: "jane.doe@example.org", channel: "x", confidence: 0.9, basis: "bio_email" });
  });
  it("does not contain the address in any readable form", async () => {
    const token = (await sealGuess(KEY, guess, "x", { now: NOW }))!;
    expect(token).not.toContain("jane");
    expect(token).not.toContain("example");
    const raw = Buffer.from(token.split(".")[2].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    expect(raw).not.toContain("jane");
    expect(raw).not.toContain("example.org");
    expect(token.length).toBeLessThanOrEqual(MAX_TOKEN_CHARS);
  });
  it("two tokens for the same guess differ (random IV)", async () => {
    expect(await sealGuess(KEY, guess, "x", { now: NOW })).not.toBe(await sealGuess(KEY, guess, "x", { now: NOW }));
  });
  it("expires after 24 hours by default and after the given time otherwise", async () => {
    const token = await sealGuess(KEY, guess, "x", { now: NOW });
    expect(await openGuess(KEY, token, NOW + 24 * 3600 * 1000 - 1)).not.toBeNull();
    expect(await openGuess(KEY, token, NOW + 24 * 3600 * 1000 + 1)).toBeNull();
    const short = await sealGuess(KEY, guess, "x", { now: NOW, ttlMs: 1000 });
    expect(await openGuess(KEY, short, NOW + 1001)).toBeNull();
  });
  it("a different key, a tampered token or a swapped part opens nothing", async () => {
    const token = (await sealGuess(KEY, guess, "x", { now: NOW }))!;
    expect(await openGuess("another-key-0123456789abcdef", token, NOW)).toBeNull();
    const [v, iv, ct] = token.split(".");
    const flipped = ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA");
    expect(await openGuess(KEY, `${v}.${iv}.${flipped}`, NOW)).toBeNull();
    const other = (await sealGuess(KEY, guess, "x", { now: NOW }))!.split(".");
    expect(await openGuess(KEY, `${v}.${other[1]}.${ct}`, NOW)).toBeNull();   // another token's IV
  });
  it("malformed, empty, oversize or wrongly typed tokens open nothing and never throw", async () => {
    for (const t of ["", "x", "v1.a.b", "v2.AAAA.BBBB", "v1..", "v1.%%%.%%%", `v1.${"A".repeat(16)}.${"B".repeat(30)}`, "a".repeat(MAX_TOKEN_CHARS + 1), null, undefined, 42, {}]) {
      expect(await openGuess(KEY, t as never, NOW), String(t)).toBeNull();
    }
  });
  it("issues nothing without a usable key, with a bad channel, a bad address or too little confidence", async () => {
    expect(await sealGuess(undefined, guess, "x")).toBeNull();
    expect(await sealGuess("short", guess, "x")).toBeNull();
    expect(await sealGuess(KEY, guess, "X Y")).toBeNull();
    expect(await sealGuess(KEY, { ...guess, email: "not-an-email" }, "x")).toBeNull();
    expect(await sealGuess(KEY, { ...guess, confidence: 0.79 }, "x")).toBeNull();
    expect(await openGuess(undefined, "v1.a.b", NOW)).toBeNull();
  });
});

describe("the switch", () => {
  it("is on only for the exact string true with a key of usable length", () => {
    expect(emailGuessOn({ EMAIL_GUESS_ENABLED: "true", EMAIL_GUESS_KEY: KEY })).toBe(true);
    expect(emailGuessOn({ EMAIL_GUESS_ENABLED: "TRUE", EMAIL_GUESS_KEY: KEY })).toBe(false);
    expect(emailGuessOn({ EMAIL_GUESS_ENABLED: "true" })).toBe(false);
    expect(emailGuessOn({ EMAIL_GUESS_ENABLED: "true", EMAIL_GUESS_KEY: "short" })).toBe(false);
    expect(emailGuessOn({ EMAIL_GUESS_KEY: KEY })).toBe(false);
    expect(emailGuessOn(undefined)).toBe(false);
  });
});
