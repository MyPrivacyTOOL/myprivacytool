// The X bot's DMs use two short links (MPC-7628). Guard that they exist and keep doing what the long links did:
//   /x       -> public/x.html: link-preview tags for X, then forwards to /scan WITH the utm tracking
//   /follow  -> X's one-tap follow intent for @MyPrivacyTOOL (public/_redirects)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(path.join(repo, p), "utf8");

describe("X bot short links", () => {
  it("/follow redirects to X's follow intent for @MyPrivacyTOOL", () => {
    const rule = read("public/_redirects").split("\n").find((l) => l.trim().split(/\s+/)[0] === "/follow");
    expect(rule, "public/_redirects needs a /follow rule").toBeTruthy();
    const [, target, status] = rule.trim().split(/\s+/);
    expect(target).toBe("https://x.com/intent/follow?screen_name=MyPrivacyTOOL");
    expect(status).toBe("302");
  });
  it("/x has link-preview tags and forwards to /scan with the utm tracking", () => {
    const html = read("public/x.html");
    for (const tag of ["og:title", "og:description", "og:image", "twitter:card"]) expect(html).toContain(tag);
    expect(html).toContain("/scan?utm_source=x&utm_medium=channel_osint&utm_campaign=bot_reply");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("noindex");
  });
  it("the bot's DMs use the short links", () => {
    const bot = read("workers/social-listeners/src/mirror-bot.ts");
    expect(bot).toContain('const SCAN_URL = "https://myprivacytool.io/x"');
    expect(bot).toContain("https://myprivacytool.io/follow");
  });
});
