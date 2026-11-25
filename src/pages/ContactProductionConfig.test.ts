// MPC-8515: production must keep the HubSpot form id for /contact. Without it the page silently falls back to opening the visitor's mail app,
// so a message from a visitor with no mail app set up is never sent, while the page promises a reply within 2 business days.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe(".env.production keeps the /contact HubSpot form (MPC-8515)", () => {
  const env = readFileSync(resolve(__dirname, "../../.env.production"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("VITE_HUBSPOT_CONTACT_FORM_ID="));

  it("sets VITE_HUBSPOT_CONTACT_FORM_ID", () => {
    expect(line, "no VITE_HUBSPOT_CONTACT_FORM_ID line: /contact would fall back to mailto").toBeDefined();
  });

  it("sets it to a real form GUID, not a test value", () => {
    const value = (line ?? "").split("=")[1]?.trim() ?? "";
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(value).not.toMatch(/e2e|test/i);
  });
});
