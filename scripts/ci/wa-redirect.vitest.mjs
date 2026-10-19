// The WhatsApp entry point is one redirect (/wa). Guard that the redirect exists and that the site links to it,
// so the business number is set in exactly one place and no page ships a placeholder wa.me link.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(path.join(repo, p), "utf8");

describe("WhatsApp entry point", () => {
  const rules = read("public/_redirects").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  it("has a /wa redirect that is either the holding page or a wa.me chat link", () => {
    const rule = rules.find((l) => l.split(/\s+/)[0] === "/wa");
    expect(rule, "public/_redirects needs a /wa rule").toBeTruthy();
    const [, target, status] = rule.split(/\s+/);
    expect(status).toBe("302");
    expect(target === "/start" || /^https:\/\/wa\.me\/\d{7,15}(\?text=[^\s]*)?$/.test(target)).toBe(true);
  });
  it("the /start WhatsApp button uses /wa and no page keeps the number placeholder", () => {
    expect(read("src/pages/Start.tsx")).toContain('url: "/wa"');
    expect(read("src/pages/Start.tsx")).not.toContain("YOUR_WHATSAPP_NUMBER");
  });
});
