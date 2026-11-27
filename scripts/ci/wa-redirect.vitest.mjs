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
  // MPC-9826: while WhatsApp is "planned" (src/config/featureStatus.ts CHANNEL_STATUS) the /start card is not a link, because /wa only bounces
  // back to /start. When it goes live, the card must point at /wa again.
  it("the /start WhatsApp card is not a link while planned, uses /wa once live, and no page keeps the number placeholder", () => {
    const start = read("src/pages/Start.tsx");
    const status = read("src/config/featureStatus.ts");
    const planned = /whatsapp:\s*"planned"/.test(status);
    if (planned) expect(start).toMatch(/id: "whatsapp"[^}]*url: ""/);
    else expect(start).toMatch(/id: "whatsapp"[^}]*url: "\/wa"/);
    expect(start).not.toContain("YOUR_WHATSAPP_NUMBER");
  });
});
