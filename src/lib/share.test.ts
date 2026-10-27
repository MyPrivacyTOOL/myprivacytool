import { describe, expect, it } from "vitest";
import { SHARE_PAGE, shareLinks, shareUrl } from "./share";

describe("share links (MPC-8451)", () => {
  it("tags each channel with its own utm_medium", () => {
    const u = new URL(shareUrl("whatsapp"));
    expect(`${u.origin}${u.pathname}`).toBe(SHARE_PAGE);
    expect(u.searchParams.get("utm_source")).toBe("share");
    expect(u.searchParams.get("utm_medium")).toBe("whatsapp");
    expect(u.searchParams.get("utm_campaign")).toBe("scan_share");
  });

  it("covers whatsapp, x, linkedin, facebook and email", () => {
    expect(shareLinks().map((l) => l.id)).toEqual(["whatsapp", "x", "linkedin", "facebook", "email"]);
  });

  it("carries only the public scan page: no email, scan number or token", () => {
    for (const l of shareLinks()) {
      const d = decodeURIComponent(l.href);
      expect(d).toContain("myprivacytool.io/scan");
      expect(d).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
      expect(d).not.toMatch(/scan_id|scanId|#v=|[?&]t=/);
    }
  });
});
